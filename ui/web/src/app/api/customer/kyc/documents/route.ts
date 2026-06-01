import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getCurrentCustomer } from '@/lib/session';
import { saveDocument, listDocumentsForCustomer, DocStorageError } from '@/lib/docStorage';
import type { DocumentKind } from '@prisma/client';

/** GET /api/customer/kyc/documents — list the signed-in buyer's docs. */
export async function GET() {
  const me = await getCurrentCustomer();
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const docs = await listDocumentsForCustomer(me.id);
  return NextResponse.json({ documents: docs });
}

const kindSchema = z.enum(['GST', 'PAN', 'COMPANY_PROOF', 'ADDRESS_PROOF', 'BANK_DETAILS', 'OTHER']);

/** POST /api/customer/kyc/documents — multipart upload of a single document. */
export async function POST(req: Request) {
  const me = await getCurrentCustomer();
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // KYC-approved customers can't re-upload (they need to ask admin to reopen).
  if (me.kycStatus === 'APPROVED') {
    return NextResponse.json({ error: 'KYC is already approved — contact admin if you need to update documents.' }, { status: 409 });
  }

  const form = await req.formData();
  const file = form.get('file');
  const kindRaw = String(form.get('kind') ?? '');
  const label = String(form.get('label') ?? '').trim();

  if (!(file instanceof File)) return NextResponse.json({ error: 'file missing' }, { status: 400 });
  const parsed = kindSchema.safeParse(kindRaw);
  if (!parsed.success) return NextResponse.json({ error: 'invalid document kind' }, { status: 400 });
  const kind: DocumentKind = parsed.data;
  if (!label) return NextResponse.json({ error: 'label required' }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    const saved = await saveDocument({
      customerId: me.id,
      kind, label,
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      bytes,
    });
    // Reset KYC back to NOT_SUBMITTED (or keep at SUBMITTED) so the buyer can
    // still add more before clicking submit. If they were in MORE_DOCS_NEEDED
    // we move them to NOT_SUBMITTED to encourage another submit-for-review.
    if (me.kycStatus === 'MORE_DOCS_NEEDED' || me.kycStatus === 'REJECTED') {
      await prisma.customer.update({
        where: { id: me.id },
        data: { kycStatus: 'NOT_SUBMITTED' },
      });
    }
    return NextResponse.json({
      id: saved.id, kind: saved.kind, label: saved.label,
      filename: saved.filename, sizeBytes: saved.sizeBytes,
      uploadedAt: saved.uploadedAt,
    });
  } catch (err: any) {
    if (err instanceof DocStorageError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
