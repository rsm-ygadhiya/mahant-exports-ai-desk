/**
 * POST /api/admin/opportunities/save
 *   body: { id, email_draft?, portal_form?, notes? }
 *
 * Persists user edits to the email + portal form while reviewing.
 */

import { NextResponse } from 'next/server';
import { requireLoggedInAdmin } from '@/lib/adminGuard';
import { update } from '@/lib/opportunities/store';
import type { EmailDraft, PortalForm } from '@/lib/opportunities/store';

export async function POST(req: Request) {
  const guard = await requireLoggedInAdmin(req);
  if (!guard.ok) return guard.response;

  let body: { id?: string; email_draft?: EmailDraft; portal_form?: PortalForm; notes?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const patch: any = {};
  if (body.email_draft) patch.email_draft = body.email_draft;
  if (body.portal_form) patch.portal_form = body.portal_form;
  if (typeof body.notes === 'string') patch.notes = body.notes;

  const updated = await update(body.id, patch);
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ opportunity: updated });
}
