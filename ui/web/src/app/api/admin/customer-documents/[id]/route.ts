import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminGuard';
import { getDocument } from '@/lib/docStorage';

/** GET /api/admin/customer-documents/:id — download/preview any customer doc. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req, 'customers', 'view');
  if (!guard.ok) return guard.response;

  const doc = await getDocument(params.id);
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return new NextResponse(doc.fileBytes as any, {
    headers: {
      'Content-Type': doc.mimeType,
      'Content-Disposition': `inline; filename="${doc.filename}"`,
      'Content-Length': String(doc.sizeBytes),
    },
  });
}
