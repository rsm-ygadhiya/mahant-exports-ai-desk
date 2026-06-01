import { NextResponse } from 'next/server';
import { getCurrentCustomer } from '@/lib/session';
import { getDocument, deleteDocument } from '@/lib/docStorage';

/** GET — download own document. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const me = await getCurrentCustomer();
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const doc = await getDocument(params.id);
  if (!doc || doc.customerId !== me.id) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return new NextResponse(doc.fileBytes as any, {
    headers: {
      'Content-Type': doc.mimeType,
      'Content-Disposition': `inline; filename="${doc.filename}"`,
      'Content-Length': String(doc.sizeBytes),
    },
  });
}

/** DELETE — buyer removes own document (only allowed pre-approval). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const me = await getCurrentCustomer();
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (me.kycStatus === 'APPROVED') {
    return NextResponse.json({ error: 'KYC is approved — contact admin to remove documents.' }, { status: 409 });
  }

  const doc = await getDocument(params.id);
  if (!doc || doc.customerId !== me.id) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  await deleteDocument(doc.id);
  return NextResponse.json({ ok: true });
}
