// Centralised server-side admin permission guard for API routes.
//
// Usage in any /api/admin/* route:
//
//   const guard = await requireAdmin(req, 'inventory', 'edit');
//   if (!guard.ok) return guard.response;
//   const admin = guard.admin;
//
// This collapses three checks into one: cookie present, admin active, has the
// specific module/action permission. The Owner role always passes.

import { NextResponse } from 'next/server';
import { getCurrentAdmin } from './session';
import { hasPermission, type ModuleKey, type Action } from './permissions';

type GuardResult =
  | { ok: true; admin: NonNullable<Awaited<ReturnType<typeof getCurrentAdmin>>> }
  | { ok: false; response: NextResponse };

export async function requireAdmin(
  _req: Request,
  module: ModuleKey,
  action: Action,
): Promise<GuardResult> {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    };
  }
  if (!hasPermission(admin, module, action)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `forbidden — missing permission ${module}.${action}` },
        { status: 403 },
      ),
    };
  }
  return { ok: true, admin };
}

/** Same but doesn't require a specific permission — just any logged-in active admin. */
export async function requireLoggedInAdmin(_req: Request): Promise<GuardResult> {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    };
  }
  return { ok: true, admin };
}
