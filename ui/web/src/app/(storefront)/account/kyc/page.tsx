import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCurrentCustomer } from '@/lib/session';
import { KycUploader } from './KycUploader';

export const dynamic = 'force-dynamic';

export default async function KycPage() {
  const me = await getCurrentCustomer();
  if (!me) redirect('/login');

  const docs = await prisma.customerDocument.findMany({
    where: { customerId: me.id },
    orderBy: { uploadedAt: 'desc' },
    select: { id: true, kind: true, label: true, filename: true, sizeBytes: true, uploadedAt: true, mimeType: true },
  });

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div>
        <Link href="/account" className="text-xs text-brand-700 hover:underline">← Back to account</Link>
        <h1 className="font-serif text-3xl mt-2">KYC Documents</h1>
        <p className="text-sm text-brand-700 mt-1">
          Upload your business documents. We need at minimum a <b>GST Certificate</b> and <b>PAN Card</b>.
          Additional documents (company proof, address proof, bank details) speed up review.
        </p>
      </div>

      <KycUploader
        currentStatus={me.kycStatus}
        rejectionReason={me.kycRejectionReason ?? null}
        initialDocs={docs.map(d => ({
          id: d.id, kind: d.kind, label: d.label, filename: d.filename,
          mimeType: d.mimeType,
          sizeBytes: d.sizeBytes,
          uploadedAt: d.uploadedAt.toISOString(),
        }))}
      />
    </div>
  );
}
