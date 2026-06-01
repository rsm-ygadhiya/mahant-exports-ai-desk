import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/adminGuard';
import { cancelOrder } from '@/lib/orders';

const schema = z.object({ reason: z.string().min(3).optional() });

/** POST /api/admin/orders/:id/cancel — reverts stones to AVAILABLE and marks the order CANCELLED. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req, 'sales', 'edit');
  if (!guard.ok) return guard.response;
  const { reason } = schema.parse(await req.json().catch(() => ({})));
  try {
    await cancelOrder(params.id, guard.admin.id, reason);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'failed to cancel' }, { status: 400 });
  }
}
