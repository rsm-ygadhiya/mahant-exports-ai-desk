import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/adminGuard';
import { createDraftOrder, confirmOrder } from '@/lib/orders';
import { audit } from '@/lib/audit';

const createSchema = z.object({
  customerId: z.string(),
  diamondIds: z.array(z.string()).min(1),
  /// Optional per-stone price override keyed by diamond id.
  prices: z.record(z.object({
    pricePerCarat: z.coerce.number().positive(),
    totalPrice: z.coerce.number().positive().optional(),
  })).optional(),
  dueDate: z.string().datetime().optional(),
  notes: z.string().optional(),
  /// If true, confirm the order immediately (flips stones to SOLD).
  confirmImmediately: z.boolean().default(true),
});

/** POST /api/admin/orders — create a new order (optionally confirm immediately). */
export async function POST(req: Request) {
  const guard = await requireAdmin(req, 'sales', 'edit');
  if (!guard.ok) return guard.response;
  const admin = guard.admin;

  try {
    const body = createSchema.parse(await req.json());
    const order = await createDraftOrder({
      customerId: body.customerId,
      diamondIds: body.diamondIds,
      prices: body.prices,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      notes: body.notes,
      createdBy: admin.id,
    });
    if (body.confirmImmediately) {
      await confirmOrder(order.id, admin.id);
    }

    await audit({
      actorId: admin.id, action: 'order.create',
      targetType: 'Order', targetId: order.id,
      notes: `${order.items.length} stone(s) · ${body.confirmImmediately ? 'CONFIRMED' : 'DRAFT'}`,
      newValue: {
        orderCode: order.orderCode,
        customerId: body.customerId,
        stoneCount: order.items.length,
        totalAmount: Number(order.totalAmount),
        confirmed: body.confirmImmediately,
      },
    });

    return NextResponse.json({ orderId: order.id, orderCode: order.orderCode });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'failed to create order' }, { status: 400 });
  }
}
