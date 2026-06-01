import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/adminGuard';
import { recordPayment } from '@/lib/payments';

const schema = z.object({
  amount: z.coerce.number().positive(),
  method: z.enum(['BANK_TRANSFER', 'CASH', 'CHEQUE', 'UPI', 'OTHER']),
  transactionRef: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * POST /api/admin/orders/:id/payments — record a payment.
 *
 * Cash payments come back PENDING_CASH_APPROVAL with a one-time token in the
 * response — show this once to the recording user, never again. Non-cash
 * methods are immediately CONFIRMED (auditable via transactionRef).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req, 'sales', 'edit');
  if (!guard.ok) return guard.response;

  try {
    const body = schema.parse(await req.json());
    const result = await recordPayment({
      orderId: params.id,
      amount: body.amount,
      method: body.method,
      transactionRef: body.transactionRef,
      notes: body.notes,
      recordedBy: guard.admin.id,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'failed to record payment' }, { status: 400 });
  }
}
