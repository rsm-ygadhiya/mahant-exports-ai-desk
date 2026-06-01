import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/audit';
import { nextCustomerCode } from '@/lib/sequentialId';
import { sendTemplatedMessage } from '@/lib/templates';

/**
 * POST /api/admin/customers/:id/kyc
 *
 * Body: { action: 'approve' | 'reject' | 'request_more_docs', reason?: string }
 *
 *  - approve              → generates unique customer code, sets KycStatus + CustomerStatus to APPROVED.
 *                           Requires customers.approve permission.
 *  - reject               → KycStatus REJECTED, account remains PENDING. Reason required.
 *  - request_more_docs    → KycStatus MORE_DOCS_NEEDED. Reason required (tells buyer what's missing).
 *
 * Spec §6.2.1. All three actions are audit-logged and trigger a customer notification.
 */
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'),            reason: z.string().optional() }),
  z.object({ action: z.literal('reject'),             reason: z.string().min(3) }),
  z.object({ action: z.literal('request_more_docs'),  reason: z.string().min(3) }),
]);

export async function POST(req: Request, { params }: { params: { id: string } }) {
  // Mutating KYC requires customers.approve specifically (not just edit).
  const guard = await requireAdmin(req, 'customers', 'approve');
  if (!guard.ok) return guard.response;
  const admin = guard.admin;

  const body = schema.parse(await req.json());
  const customer = await prisma.customer.findUnique({ where: { id: params.id } });
  if (!customer) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const now = new Date();

  if (body.action === 'approve') {
    // Idempotent — if already approved, just return the existing code.
    if (customer.kycStatus === 'APPROVED' && customer.uniqueCode) {
      return NextResponse.json({
        customer: { id: customer.id, uniqueCode: customer.uniqueCode, kycStatus: customer.kycStatus },
        alreadyApproved: true,
      });
    }
    const uniqueCode = customer.uniqueCode ?? await nextCustomerCode(now);
    const updated = await prisma.customer.update({
      where: { id: customer.id },
      data: {
        uniqueCode,
        status: 'APPROVED',
        kycStatus: 'APPROVED',
        kycReviewedAt: now,
        kycReviewedBy: admin.id,
        kycRejectionReason: null,
      },
    });

    await audit({
      actorId: admin.id, action: 'kyc.approve', targetType: 'Customer', targetId: customer.id,
      oldValue: { kycStatus: customer.kycStatus, status: customer.status, uniqueCode: customer.uniqueCode },
      newValue: { kycStatus: 'APPROVED', status: 'APPROVED', uniqueCode },
    });
    await sendTemplatedMessage({
      key: 'kyc.approve', customer,
      vars: { contactPerson: customer.contactPerson, companyName: customer.companyName, uniqueCode },
    });

    return NextResponse.json({ customer: updated });
  }

  if (body.action === 'reject') {
    const updated = await prisma.customer.update({
      where: { id: customer.id },
      data: {
        kycStatus: 'REJECTED',
        kycReviewedAt: now,
        kycReviewedBy: admin.id,
        kycRejectionReason: body.reason,
      },
    });
    await audit({
      actorId: admin.id, action: 'kyc.reject', targetType: 'Customer', targetId: customer.id,
      oldValue: { kycStatus: customer.kycStatus }, newValue: { kycStatus: 'REJECTED' },
      notes: body.reason,
    });
    await sendTemplatedMessage({
      key: 'kyc.reject', customer,
      vars: { contactPerson: customer.contactPerson, reason: body.reason },
    });
    return NextResponse.json({ customer: updated });
  }

  // request_more_docs
  const updated = await prisma.customer.update({
    where: { id: customer.id },
    data: {
      kycStatus: 'MORE_DOCS_NEEDED',
      kycReviewedAt: now,
      kycReviewedBy: admin.id,
      kycRejectionReason: body.reason,
    },
  });
  await audit({
    actorId: admin.id, action: 'kyc.request_docs', targetType: 'Customer', targetId: customer.id,
    oldValue: { kycStatus: customer.kycStatus }, newValue: { kycStatus: 'MORE_DOCS_NEEDED' },
    notes: body.reason,
  });
  await sendTemplatedMessage({
    key: 'kyc.request_docs', customer,
    vars: { contactPerson: customer.contactPerson, reason: body.reason },
  });
  return NextResponse.json({ customer: updated });
}
