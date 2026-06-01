// Order lifecycle + payment-status helpers.
//
// An Order goes DRAFT → CONFIRMED → (optionally CANCELLED). Confirming flips
// every linked Diamond to SOLD; cancelling reverts them to AVAILABLE.
//
// "Payment status" of an order isn't stored — it's derived from the sum of its
// CONFIRMED payments compared to the total. Cleanly handles partial / overdue.

import { prisma } from './db';
import { nextOrderCode } from './sequentialId';
import { audit } from './audit';

export type DerivedPaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERDUE';

export type CreateOrderInput = {
  customerId: string;
  diamondIds: string[];
  /// Override per-stone prices. If omitted for a stone, the snapshot uses
  /// the stone's current `pricePerCarat`.
  prices?: Record<string, { pricePerCarat: number; totalPrice?: number }>;
  dueDate?: Date | null;
  notes?: string;
  createdBy: string;
};

/**
 * Create a DRAFT order. Stones are NOT yet flipped — that happens at confirm-time.
 * If the customer or diamonds don't exist (or stones aren't in a saleable
 * status: AVAILABLE or HOLD), throws.
 */
export async function createDraftOrder(input: CreateOrderInput) {
  if (input.diamondIds.length === 0) throw new Error('Order must include at least one stone.');

  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) throw new Error('Customer not found.');

  const stones = await prisma.diamond.findMany({ where: { id: { in: input.diamondIds } } });
  if (stones.length !== input.diamondIds.length) {
    throw new Error('One or more stones not found.');
  }
  const ineligible = stones.filter(s => s.status !== 'AVAILABLE' && s.status !== 'HOLD');
  if (ineligible.length > 0) {
    throw new Error(`Stones not saleable (status must be AVAILABLE or HOLD): ${ineligible.map(s => s.stoneId).join(', ')}`);
  }

  const items = stones.map(s => {
    const override = input.prices?.[s.id];
    const ppc = override?.pricePerCarat ?? Number(s.pricePerCarat);
    const total = override?.totalPrice ?? ppc * Number(s.carat);
    return { diamondId: s.id, pricePerCarat: ppc, totalPrice: total };
  });
  const totalAmount = items.reduce((acc, it) => acc + it.totalPrice, 0);

  const code = await nextOrderCode();
  const order = await prisma.order.create({
    data: {
      orderCode: code,
      customerId: input.customerId,
      status: 'DRAFT',
      totalAmount: totalAmount as any,
      currency: stones[0]?.currency ?? 'USD',
      dueDate: input.dueDate ?? null,
      notes: input.notes,
      createdBy: input.createdBy,
      items: { create: items.map(it => ({ diamondId: it.diamondId, pricePerCarat: it.pricePerCarat as any, totalPrice: it.totalPrice as any })) },
    },
    include: { items: true },
  });

  return order;
}

/** Confirm a DRAFT order: flips all stones to SOLD, marks confirmedAt. */
export async function confirmOrder(orderId: string, adminId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) throw new Error('Order not found.');
  if (order.status === 'CONFIRMED') return order; // idempotent
  if (order.status === 'CANCELLED') throw new Error('Cannot confirm a cancelled order.');

  const diamondIds = order.items.map(i => i.diamondId);
  const stones = await prisma.diamond.findMany({ where: { id: { in: diamondIds } } });
  const ineligible = stones.filter(s => s.status === 'SOLD' || s.status === 'NOT_LIVE');
  if (ineligible.length > 0) {
    throw new Error(`Cannot confirm — these stones are not saleable: ${ineligible.map(s => s.stoneId).join(', ')}`);
  }

  await prisma.$transaction([
    prisma.diamond.updateMany({
      where: { id: { in: diamondIds } },
      data: { status: 'SOLD' },
    }),
    prisma.order.update({
      where: { id: orderId },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    }),
  ]);

  await audit({
    actorId: adminId, action: 'enquiry.approve_sale', targetType: 'Order', targetId: orderId,
    newValue: { status: 'CONFIRMED', stones: diamondIds.length },
  });

  return prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
}

/** Cancel an order — reverts confirmed stones back to AVAILABLE. */
export async function cancelOrder(orderId: string, adminId: string, reason?: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) throw new Error('Order not found.');
  if (order.status === 'CANCELLED') return order;

  const diamondIds = order.items.map(i => i.diamondId);

  await prisma.$transaction([
    // Only revert SOLD stones (don't disturb anything else).
    prisma.diamond.updateMany({
      where: { id: { in: diamondIds }, status: 'SOLD' },
      data: { status: 'AVAILABLE' },
    }),
    prisma.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED', cancelledAt: new Date(), notes: reason ? `${order.notes ?? ''}\nCancelled: ${reason}`.trim() : order.notes },
    }),
  ]);

  await audit({
    actorId: adminId, action: 'order.cancel', targetType: 'Order', targetId: orderId,
    notes: reason,
    newValue: { stonesReverted: diamondIds.length },
  });

  return prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
}

/**
 * Derive an order's payment status from its CONFIRMED payments.
 * Pending cash-approval payments don't count toward paid-amount.
 */
export function derivePaymentStatus(order: {
  totalAmount: any; dueDate: Date | null;
  payments: Array<{ amount: any; status: string }>;
}): { status: DerivedPaymentStatus; paid: number; outstanding: number } {
  const total = Number(order.totalAmount);
  const paid = order.payments
    .filter(p => p.status === 'CONFIRMED')
    .reduce((s, p) => s + Number(p.amount), 0);
  const outstanding = Math.max(0, total - paid);

  let status: DerivedPaymentStatus = 'UNPAID';
  if (paid >= total) status = 'PAID';
  else if (paid > 0) status = 'PARTIAL';

  if (status !== 'PAID' && order.dueDate && order.dueDate.getTime() < Date.now()) {
    status = 'OVERDUE';
  }
  return { status, paid, outstanding };
}
