import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminGuard';
import { importRapSheetFromBuffer, type RapImportSummary } from '@/lib/rapImport';
import { audit } from '@/lib/audit';

/**
 * POST /api/admin/rap/import — multipart upload of one or more Rap sheets.
 *
 * FormData keys:
 *   files       (one or more File entries — repeated `files` keys)
 *   sheetDate   (ISO date string, optional — defaults to today)
 */
export async function POST(req: Request) {
  const guard = await requireAdmin(req, 'pricing', 'edit');
  if (!guard.ok) return guard.response;
  const admin = guard.admin;

  const form = await req.formData();
  const files = form.getAll('files').filter((f): f is File => f instanceof File);
  if (!files.length) return NextResponse.json({ error: 'no files attached' }, { status: 400 });

  const sheetDateRaw = String(form.get('sheetDate') ?? '');
  const sheetDate = sheetDateRaw ? new Date(sheetDateRaw) : new Date();
  if (Number.isNaN(sheetDate.getTime())) {
    return NextResponse.json({ error: 'invalid sheetDate' }, { status: 400 });
  }

  const summaries: RapImportSummary[] = [];
  for (const file of files) {
    const buf = Buffer.from(await file.arrayBuffer());
    const summary = await importRapSheetFromBuffer(buf, file.name, sheetDate, admin.id);
    summaries.push(summary);
  }

  const totals = summaries.reduce(
    (acc, s) => ({
      rowsTotal: acc.rowsTotal + s.rowsTotal,
      rowsInserted: acc.rowsInserted + s.rowsInserted,
      rowsUpdated: acc.rowsUpdated + s.rowsUpdated,
      rowsFailed: acc.rowsFailed + s.rowsFailed,
    }),
    { rowsTotal: 0, rowsInserted: 0, rowsUpdated: 0, rowsFailed: 0 },
  );

  await audit({
    actorId: admin.id, action: 'rap.import',
    notes: `${summaries.length} file(s) · ${totals.rowsInserted} new + ${totals.rowsUpdated} updated · sheet ${sheetDate.toISOString().slice(0,10)}`,
    newValue: { sheetDate: sheetDate.toISOString(), files: summaries.map(s => s.filename), totals },
  });

  return NextResponse.json({ sheetDate: sheetDate.toISOString(), files: summaries, totals });
}
