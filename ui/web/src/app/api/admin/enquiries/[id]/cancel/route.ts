import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/audit';
import { sendTemplatedMessage, render } from '@/lib/templates';

/**
 * POST /api/admin/enquiries/:id/cancel
 *
 * Spec §7.3 — Cancel. Records the reason, marks the enquiry CANCELLED,
 * sends the customer the cancellation template. Stones are NOT touched
 * (cancellation is for the enquiry only; if stones were on memo for this
 * customer, admin should release them separately).
 *
 * Permission: enquiries.approve.
 */
const schema = z.object({
  reason: z.string().min(3),
  customSubject: z.string().optional(),
  customBody: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req, 'enquiries', 'approve');
  if (!guard.ok) return guard.response;
  const admin = guard.admin;

  const body = schema.parse(await req.json());

  const enquiry = await prisma.enquiry.findUnique({
    where: { id: params.id },
    include: { customer: true, items: { include: { diamond: true } } },
  });
  if (!enquiry) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (enquiry.status === 'APPROVED_SALE' || enquiry.status === 'CANCELLED') {
    return NextResponse.json({ error: `Already in terminal state: ${enquiry.status}` }, { status: 409 });
  }

  await prisma.enquiry.update({
    where: { id: enquiry.id },
    data: {
      status: 'CANCELLED',
      cancellationReason: body.reason,
      decidedAt: new Date(),
      decidedBy: admin.id,
    },
  });

  await audit({
    actorId: admin.id, action: 'enquiry.cancel',
    targetType: 'Enquiry', targetId: enquiry.id,
    notes: body.reason,
  });

  const stonesList = enquiry.items
    .map(it => `• ${it.diamond.stoneId} — ${it.diamond.shape} ${Number(it.diamond.carat).toFixed(2)}ct ${it.diamond.color}/${it.diamond.clarity}`)
    .join('\n');
  const vars = {
    contactPerson: enquiry.customer.contactPerson,
    companyName: enquiry.customer.companyName,
    stonesList,
    reason: body.reason,
  };

  if (body.customBody) {
    const { notifyCustomer } = await import('@/lib/notify');
    await notifyCustomer({
      customer: enquiry.customer,
      subject: body.customSubject ? render(body.customSubject, vars) : 'Mahant Exports — Enquiry Update',
      body: render(body.customBody, vars),
      reason: 'enquiry.cancelled (custom)',
    });
  } else {
    await sendTemplatedMessage({ key: 'enquiry.cancelled', customer: enquiry.customer, vars });
  }

  return NextResponse.json({ ok: true });
}
