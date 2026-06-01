import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/adminGuard';
import { parseDiamondQuery, buildDiamondWhere, buildDiamondOrderBy } from '@/lib/diamondQuery';
import { diamondsToXlsx } from '@/lib/excelExport';

export async function GET(req: Request) {
  const guard = await requireAdmin(req, 'inventory', 'view');
  if (!guard.ok) return guard.response;

  const sp = new URL(req.url).searchParams;
  const q = parseDiamondQuery(sp);
  const where = buildDiamondWhere(q, { adminMode: true });

  const diamonds = await prisma.diamond.findMany({
    where,
    orderBy: buildDiamondOrderBy(q.sort),
    take: 50_000, // safety cap
  });

  const xlsx = diamondsToXlsx(diamonds, sp.get('sheet') ?? 'Stock');
  const filename = sp.get('filename') ?? `mahant-stock-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(xlsx as any, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(xlsx.byteLength),
    },
  });
}
