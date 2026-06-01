import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/adminGuard';
import { rejectCashPayment } from '@/lib/payments';

const schema = z.object({ reason: z.string().min(3) });

/** POST /api/admin/payments/:id/reject — reject a pending cash payment. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req, 'cash', 'approve');
  if (!guard.ok) return guard.response;

  const { reason } = schema.parse(await req.json());
  try {
    await rejectCashPayment({ paymentId: params.id, reason, rejectedBy: guard.admin.id });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'reject failed' }, { status: 400 });
  }
}
