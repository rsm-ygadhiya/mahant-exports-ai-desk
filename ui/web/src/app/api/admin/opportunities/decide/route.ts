/**
 * POST /api/admin/opportunities/decide  { id, action: 'send' | 'discard' }
 *
 * Final human review step. For the demo, "send" just records the action and
 * timestamp — no SMTP. The audit trail is the JSON file under .opp-state.json.
 */

import { NextResponse } from 'next/server';
import { requireLoggedInAdmin } from '@/lib/adminGuard';
import { update } from '@/lib/opportunities/store';

export async function POST(req: Request) {
  const guard = await requireLoggedInAdmin(req);
  if (!guard.ok) return guard.response;

  let body: { id?: string; action?: 'send' | 'discard' };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  if (!body.id || !body.action) {
    return NextResponse.json({ error: 'id and action required' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const patch = body.action === 'send'
    ? { status: 'sent' as const, sent_at: now }
    : { status: 'discarded' as const, discarded_at: now };

  const updated = await update(body.id, patch);
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ opportunity: updated });
}
