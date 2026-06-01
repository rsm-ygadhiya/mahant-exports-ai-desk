/**
 * POST /api/admin/opportunities/pursue  { id: string }
 *
 * Pulls inventory + Mahant profile, prefills the portal form, drafts the
 * outreach email via Claude, marks the opportunity as `pursuing`, and
 * returns the populated record.
 */

import { NextResponse } from 'next/server';
import { requireLoggedInAdmin } from '@/lib/adminGuard';
import { getOne, update } from '@/lib/opportunities/store';
import { buildInventorySnapshot } from '@/lib/opportunities/inventorySnapshot';
import { draftEmail, prefillPortalForm } from '@/lib/opportunities/enrich';

export async function POST(req: Request) {
  const guard = await requireLoggedInAdmin(req);
  if (!guard.ok) return guard.response;

  let body: { id?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const id = (body.id ?? '').trim();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const opp = await getOne(id);
  if (!opp) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const snapshot = await buildInventorySnapshot();
  const [email, form] = await Promise.all([
    draftEmail(opp, snapshot),
    Promise.resolve(prefillPortalForm(opp, snapshot)),
  ]);

  const updated = await update(id, {
    status: 'pursuing',
    email_draft: email,
    portal_form: form,
  });

  return NextResponse.json({ opportunity: updated });
}
