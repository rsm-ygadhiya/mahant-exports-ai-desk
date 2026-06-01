import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { setAdminSession } from '@/lib/session';
import { audit } from '@/lib/audit';

export async function POST(req: Request) {
  const { email, password } = z.object({
    email: z.string().email(),
    password: z.string(),
  }).parse(await req.json());

  const admin = await prisma.admin.findUnique({ where: { email } });
  if (!admin) return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
  if (!admin.isActive) return NextResponse.json({ error: 'account disabled' }, { status: 403 });

  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });

  await setAdminSession(admin.id, admin.role);

  // Record sign-in for the audit log. Best-effort IP capture for accountability.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
           ?? req.headers.get('x-real-ip')
           ?? null;
  await audit({
    actorId: admin.id,
    action: 'admin.login',
    targetType: 'Admin',
    targetId: admin.id,
    ipAddress: ip ?? undefined,
  });

  return NextResponse.json({ ok: true });
}
