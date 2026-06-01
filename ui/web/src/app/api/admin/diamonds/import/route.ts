import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireAdmin } from '@/lib/adminGuard';
import { importDiamondsFromBuffer, type ImportMode } from '@/lib/excelImport';
import { audit } from '@/lib/audit';

export async function POST(req: Request) {
  const guard = await requireAdmin(req, 'inventory', 'edit');
  if (!guard.ok) return guard.response;
  const admin = guard.admin;

  const form = await req.formData();
  const file = form.get('file');
  const passcode = String(form.get('passcode') ?? '');
  const modeRaw = String(form.get('mode') ?? 'edit');
  const mode: ImportMode = modeRaw === 'add' ? 'add' : 'edit';

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file missing' }, { status: 400 });
  }
  if (!passcode) {
    return NextResponse.json({ error: 'passcode required' }, { status: 400 });
  }

  // Confirm the admin's identity again before applying the import.
  // This is the same password used to log in — keeps secret-management simple.
  const ok = await bcrypt.compare(passcode, admin.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: 'incorrect passcode' }, { status: 403 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const summary = await importDiamondsFromBuffer(buffer, admin.id, file.name, mode);

  await audit({
    actorId: admin.id, action: 'stone.import',
    targetType: 'StockUpload', targetId: file.name,
    notes: `${summary.rowsCreated} created · ${summary.rowsUpdated} updated · ${summary.rowsFailed} failed · mode=${mode}`,
    newValue: {
      filename: file.name, mode,
      rowsTotal: summary.rowsTotal, rowsCreated: summary.rowsCreated,
      rowsUpdated: summary.rowsUpdated, rowsFailed: summary.rowsFailed,
    },
  });

  return NextResponse.json(summary);
}
