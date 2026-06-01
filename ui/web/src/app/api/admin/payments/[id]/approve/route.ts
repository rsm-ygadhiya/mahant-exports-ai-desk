import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/adminGuard';
import { confirmCashPayment } from '@/lib/payments';

const schema = z.object({
  token: z.string().length(6, 'Approval code is 6 digits'),
});

/**
 * POST /api/admin/payments/:id/approve — confirm a pending cash payment with
 * the one-time token from the recording user.
 *
 * Permission: cash.approve (Accounts role by default). This is the ONE place
 * cash can be confirmed — Sales explicitly cannot bypass it.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req, 'cash', 'approve');
  if (!guard.ok) return guard.response;

  const { token } = schema.parse(await req.json());
  const result = await confirmCashPayment({
    paymentId: params.id,
    token,
    confirmedBy: guard.admin.id,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
