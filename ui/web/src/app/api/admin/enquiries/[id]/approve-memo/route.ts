import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/audit';
import { sendTemplatedMessage, render } from '@/lib/templates';

/**
 * POST /api/admin/enquiries/:id/approve-memo
 *
 * Spec §7.3 — Approve → Memo. Flips every stone in the enquiry to HOLD,
 * records the pickup location/time, and sends the customer the
 * "memo approved" template. The admin can pass `customBody` to override
 * the template body (the form lets them edit before sending).
 *
 * Permission: enquiries.approve.
 */
const schema = z.object({
  memoLocation: z.string().min(1),
  memoPickupAt: z.string().datetime(),
  customSubject: z.string().optional(),
  customBody: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req, 'enquiries', 'approve');
  if (!guard.ok) return guard.response;
  const admin = guard.admin;

  const body = schema.parse(await req.json());
  const memoPickupAt = new Date(body.memoPickupAt);

  const enquiry = await prisma.enquiry.findUnique({
    where: { id: params.id },
    include: { customer: true, items: { include: { diamond: true } } },
  });
  if (!enquiry) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (enquiry.status === 'APPROVED_MEMO' || enquiry.status === 'APPROVED_SALE' || enquiry.status === 'CANCELLED') {
    return NextResponse.json({ error: `Already in terminal state: ${enquiry.status}` }, { status: 409 });
  }

  const diamondIds = enquiry.items.map(i => i.diamondId);
  // Only flip stones that are AVAILABLE — don't disturb anything already sold/holding for someone else.
  const ineligible = enquiry.items
    .filter(i => i.diamond.status !== 'AVAILABLE' && i.diamond.status !== 'HOLD')
    .map(i => i.diamond.stoneId);
  if (ineligible.length > 0) {
    return NextResponse.json({ error: `Stones not available for memo: ${ineligible.join(', ')}` }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.diamond.updateMany({
      where: { id: { in: diamondIds }, status: 'AVAILABLE' },
      data: { status: 'HOLD' },
    }),
    prisma.enquiry.update({
      where: { id: enquiry.id },
      data: {
        status: 'APPROVED_MEMO',
        memoLocation: body.memoLocation,
        memoPickupAt,
        decidedAt: new Date(),
        decidedBy: admin.id,
      },
    }),
  ]);

  await audit({
    actorId: admin.id, action: 'enquiry.approve_memo',
    targetType: 'Enquiry', targetId: enquiry.id,
    newValue: { stones: diamondIds.length, location: body.memoLocation },
  });

  // Send message — either custom-edited or templated.
  const stonesList = enquiry.items
    .map(it => `• ${it.diamond.stoneId} — ${it.diamond.shape} ${Number(it.diamond.carat).toFixed(2)}ct ${it.diamond.color}/${it.diamond.clarity}`)
    .join('\n');
  const vars = {
    contactPerson: enquiry.customer.contactPerson,
    companyName: enquiry.customer.companyName,
    stonesList,
    memoLocation: body.memoLocation,
    memoPickupAt: memoPickupAt.toLocaleString(),
  };

  if (body.customBody) {
    // Use the admin's edited body but still go through the notify layer for audit + channel routing.
    const { notifyCustomer } = await import('@/lib/notify');
    await notifyCustomer({
      customer: enquiry.customer,
      subject: body.customSubject ? render(body.customSubject, vars) : 'Mahant Exports — Memo Approved',
      body: render(body.customBody, vars),
      reason: 'enquiry.memo_approved (custom)',
    });
  } else {
    await sendTemplatedMessage({ key: 'enquiry.memo_approved', customer: enquiry.customer, vars });
  }

  return NextResponse.json({ ok: true });
}
