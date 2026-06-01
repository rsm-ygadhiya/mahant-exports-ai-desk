// One-off importer that exercises the exact same code path as the admin
// upload endpoint, so we verify the library works end-to-end on the real DB.
import { readFileSync } from 'node:fs';
import { importDiamondsFromBuffer } from '../src/lib/excelImport';
import { prisma } from '../src/lib/db';

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error('usage: tsx scripts/import-csv.ts <path-to-csv>');
  const buf = readFileSync(path);

  // Use the seeded admin's id so the StockUpload row links cleanly.
  const admin = await prisma.admin.findFirst();
  if (!admin) throw new Error('No admin in DB — run `npm run seed` first.');

  const mode = (process.argv[3] === 'add' ? 'add' : 'edit') as 'add' | 'edit';
  console.log(`Importing ${path} as admin ${admin.email} (mode=${mode})…`);
  const summary = await importDiamondsFromBuffer(buf, admin.id, path.split('/').pop() ?? 'upload.csv', mode);
  console.log(JSON.stringify({
    mode: summary.mode,
    rowsTotal: summary.rowsTotal,
    rowsCreated: summary.rowsCreated,
    rowsUpdated: summary.rowsUpdated,
    rowsSkipped: summary.rowsSkipped,
    rowsFailed: summary.rowsFailed,
    firstFewErrors: summary.errors.slice(0, 5),
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
