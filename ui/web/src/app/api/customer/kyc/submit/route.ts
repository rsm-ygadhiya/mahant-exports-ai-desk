import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentCustomer } from '@/lib/session';

/**
 * POST /api/customer/kyc/submit — mark KYC as submitted (review-pending).
 *
 * Requires at least a GST and a PAN document on file. If you ever need different
 * minimums for a market, the check happens here.
 */
const REQUIRED_KINDS = ['GST', 'PAN'] as const;

export async function POST() {
  const me = await getCurrentCustomer();
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (me.kycStatus === 'APPROVED') {
    return NextResponse.json({ error: 'KYC is already approved.' }, { status: 409 });
  }

  const docs = await prisma.customerDocument.findMany({
    where: { customerId: me.id },
    select: { kind: true },
  });
  const have = new Set(docs.map(d => d.kind));
  const missing = REQUIRED_KINDS.filter(k => !have.has(k));
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Upload these first: ${missing.join(', ')}` },
      { status: 400 },
    );
  }

  await prisma.customer.update({
    where: { id: me.id },
    data: {
      kycStatus: 'SUBMITTED',
      kycSubmittedAt: new Date(),
      kycRejectionReason: null,
    },
  });
  return NextResponse.json({ ok: true });
}
