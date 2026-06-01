import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireAdmin } from '@/lib/adminGuard';
import { applyPricingRun } from '@/lib/pricingWorkflow';
import { audit } from '@/lib/audit';

/**
 * POST /api/admin/pricing/runs/:id/apply — push approved proposals to live stock.
 *
 * Requires the admin's password in the body, same pattern as the Excel upload.
 * Also requires the `pricing.approve` permission server-side.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req, 'pricing', 'approve');
  if (!guard.ok) return guard.response;
  const admin = guard.admin;

  const body = await req.json().catch(() => ({}));
  const passcode = String(body.passcode ?? '');
  if (!passcode) return NextResponse.json({ error: 'passcode required' }, { status: 400 });

  const ok = await bcrypt.compare(passcode, admin.passwordHash);
  if (!ok) return NextResponse.json({ error: 'incorrect passcode' }, { status: 403 });

  const result = await applyPricingRun(params.id, admin.id);
  await audit({ actorId: admin.id, action: 'pricing.apply', targetType: 'PricingRun', targetId: params.id, newValue: result });
  return NextResponse.json(result);
}
