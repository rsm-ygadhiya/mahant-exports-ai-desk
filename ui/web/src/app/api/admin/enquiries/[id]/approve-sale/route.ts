import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/audit';
import { createDraftOrder, confirmOrder } from '@/lib/orders';
import { sendTemplatedMessage, render } from '@/lib/templates';
import { fmtUsd } from '@/lib/format';

/**
 * POST /api/admin/enquiries/:id/approve-sale
 *
 * Spec §7.3 — Approve → Sale. Creates a CONFIRMED Order from the enquiry's
 * stones (reusing the P4 order lifecycle), sends the customer a sale
 * confirmation message, and optionally a separate "bank details" message
 * (default: yes).
 *
 * Body: { dueDate?, customSubject?, customBody?, sendBankDetails?: boolean }
 * Permission: enquiries.approve.
 */
const schema = z.object({
  dueDate: z.string().datetime().optional(),
  customSubject: z.string().optional(),
  customBody: z.string().optional(),
  sendBankDetails: z.boolean().default(true),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req, 'enquiries', 'approve');
  if (!guard.ok) return guard.response;
  const admin = guard.admin;

  const body = schema.parse(await req.json().catch(() => ({})));

  const enquiry = await prisma.enquiry.findUnique({
    where: { id: params.id },
    include: { customer: true, items: { include: { diamond: true } } },
  });
  if (!enquiry) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (enquiry.status === 'APPROVED_SALE' || enquiry.status === 'CANCELLED') {
    return NextResponse.json({ error: `Already in terminal state: ${enquiry.status}` }, { status: 409 });
  }

  // Spin up a CONFIRMED order using the enquiry's snapshot prices.
  const prices: Record<string, { pricePerCarat: number; totalPrice: number }> = {};
  for (const it of enquiry.items) {
    prices[it.diamondId] = {
      pricePerCarat: Number(it.pricePerCarat),
      totalPrice: Number(it.totalPrice),
    };
  }

  let order;
  try {
    const draft = await createDraftOrder({
      customerId: enquiry.customerId,
      diamondIds: enquiry.items.map(i => i.diamondId),
      prices,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      notes: `From enquiry ${enquiry.id}${enquiry.message ? `\nBuyer note: ${enquiry.message}` : ''}`,
      createdBy: admin.id,
    });
    order = await confirmOrder(draft.id, admin.id);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'failed to create order' }, { status: 400 });
  }

  await prisma.enquiry.update({
    where: { id: enquiry.id },
    data: {
      status: 'APPROVED_SALE',
      orderId: order!.id,
      decidedAt: new Date(),
      decidedBy: admin.id,
    },
  });

  await audit({
    actorId: admin.id, action: 'enquiry.approve_sale',
    targetType: 'Enquiry', targetId: enquiry.id,
    newValue: { orderId: order!.id },
  });

  // Send the customer confirmation + (optionally) bank details.
  const stonesList = enquiry.items
    .map(it => `• ${it.diamond.stoneId} — ${it.diamond.shape} ${Number(it.diamond.carat).toFixed(2)}ct ${it.diamond.color}/${it.diamond.clarity} — ${fmtUsd(Number(it.totalPrice))}`)
    .join('\n');
  const totalAmount = fmtUsd(Number(order!.totalAmount));
  const dueDate = order!.dueDate ? new Date(order!.dueDate).toLocaleDateString() : 'On invoice';
  const vars = {
    contactPerson: enquiry.customer.contactPerson,
    companyName: enquiry.customer.companyName,
    stonesList,
    orderCode: order!.orderCode,
    totalAmount,
    dueDate,
  };

  if (body.customBody) {
    const { notifyCustomer } = await import('@/lib/notify');
    await notifyCustomer({
      customer: enquiry.customer,
      subject: body.customSubject ? render(body.customSubject, vars) : `Mahant Exports — Sale Confirmation ${order!.orderCode}`,
      body: render(body.customBody, vars),
      reason: 'enquiry.sale_confirmed (custom)',
    });
  } else {
    await sendTemplatedMessage({ key: 'enquiry.sale_confirmed', customer: enquiry.customer, vars });
  }

  if (body.sendBankDetails) {
    await sendTemplatedMessage({ key: 'bank.details', customer: enquiry.customer, vars });
  }

  return NextResponse.json({ orderId: order!.id, orderCode: order!.orderCode });
}
