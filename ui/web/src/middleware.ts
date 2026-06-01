import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-secret-change-me');

/**
 * Guard /admin/* — require an admin JWT cookie. /admin/login is exempt.
 * Edge-compatible: uses jose (no Node bcrypt/etc).
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith('/admin')) return NextResponse.next();
  if (pathname === '/admin/login') return NextResponse.next();

  const token = req.cookies.get('mahant_admin')?.value;
  if (!token) return NextResponse.redirect(new URL('/admin/login', req.url));

  try {
    const { payload } = await jwtVerify(token, SECRET);
    if ((payload as any).kind !== 'admin') {
      return NextResponse.redirect(new URL('/admin/login', req.url));
    }
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL('/admin/login', req.url));
  }
}

export const config = {
  matcher: ['/admin/:path*'],
};
