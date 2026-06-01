/**
 * POST /api/admin/opportunities/reset
 *
 * Wipes all opportunities from the JSON store. Used by the Reset button
 * for clean demo runs.
 */

import { NextResponse } from 'next/server';
import { requireLoggedInAdmin } from '@/lib/adminGuard';
import { clear } from '@/lib/opportunities/store';

export async function POST(req: Request) {
  const guard = await requireLoggedInAdmin(req);
  if (!guard.ok) return guard.response;
  await clear();
  return NextResponse.json({ ok: true });
}
