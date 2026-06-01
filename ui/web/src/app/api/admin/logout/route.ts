import { NextResponse } from 'next/server';
import { getCurrentAdmin, clearAdminSession } from '@/lib/session';
import { audit } from '@/lib/audit';

// The Sign-out button is a plain HTML form (POST /api/admin/logout). After
// clearing the cookie we 303-redirect back to the login screen so the browser
// follows the redirect with a GET.
async function doLogout(req: Request) {
  const admin = await getCurrentAdmin();
  if (admin) {
    await audit({
      actorId: admin.id,
      action: 'admin.logout',
      targetType: 'Admin',
      targetId: admin.id,
    });
  }
  clearAdminSession();
  const url = new URL('/admin/login', req.url);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(req: Request) { return doLogout(req); }
export async function GET(req: Request)  { return doLogout(req); }
