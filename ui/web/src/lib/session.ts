import { cookies } from 'next/headers';
import { prisma } from './db';
import { sign, verify, type AdminJwt, type CustomerJwt } from './jwt';

const CUSTOMER_COOKIE = 'mahant_session';
const ADMIN_COOKIE = 'mahant_admin';

// 30-day persistent session. Both `maxAge` (in seconds) AND `expires` (absolute
// Date) are set — some browsers honour only one or the other. Without `expires`,
// some treat the cookie as session-only and drop it when the window closes.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
    expires: new Date(Date.now() + COOKIE_MAX_AGE * 1000),
  };
}

// ── customer session ──
export async function setCustomerSession(customerId: string) {
  const token = await sign({ sub: customerId, kind: 'customer' });
  cookies().set(CUSTOMER_COOKIE, token, cookieOpts());
}

export function clearCustomerSession() {
  cookies().delete(CUSTOMER_COOKIE);
}

export async function getCustomerSession(): Promise<CustomerJwt | null> {
  const c = cookies().get(CUSTOMER_COOKIE);
  if (!c) return null;
  try {
    const payload = await verify(c.value);
    return payload.kind === 'customer' ? payload : null;
  } catch { return null; }
}

export async function getCurrentCustomer() {
  const session = await getCustomerSession();
  if (!session) return null;
  return prisma.customer.findUnique({
    where: { id: session.sub },
    include: { pricingRule: true },
  });
}

// ── admin session ──
export async function setAdminSession(adminId: string, role: string) {
  const token = await sign({ sub: adminId, kind: 'admin', role });
  cookies().set(ADMIN_COOKIE, token, cookieOpts());
}

export function clearAdminSession() {
  cookies().delete(ADMIN_COOKIE);
}

export async function getAdminSession(): Promise<AdminJwt | null> {
  const c = cookies().get(ADMIN_COOKIE);
  if (!c) return null;
  try {
    const payload = await verify(c.value);
    return payload.kind === 'admin' ? payload : null;
  } catch { return null; }
}

export async function getCurrentAdmin() {
  const session = await getAdminSession();
  if (!session) return null;
  const admin = await prisma.admin.findUnique({
    where: { id: session.sub },
    include: { customRole: true },
  });
  // Treat soft-disabled admins as if they weren't logged in.
  if (!admin || !admin.isActive) return null;
  return admin;
}
