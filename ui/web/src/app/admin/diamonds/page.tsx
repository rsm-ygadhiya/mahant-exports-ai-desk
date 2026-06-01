import Link from 'next/link';
import { prisma } from '@/lib/db';
import { parseDiamondQuery, buildDiamondWhere, buildDiamondOrderBy } from '@/lib/diamondQuery';
import { fmtCarat, fmtUsd } from '@/lib/format';
import { StatusBadge } from '@/components/StatusBadge';
import { Pagination } from '@/components/Pagination';
import { StatusActions } from './StatusActions';
import { FilterBar } from './FilterBar';

export const dynamic = 'force-dynamic';

export default async function AdminDiamondsPage({
  searchParams,
}: { searchParams: Record<string, string | string[] | undefined> }) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === 'string') sp.set(k, v);
  }
  const q = parseDiamondQuery(sp);
  const where = buildDiamondWhere(q, { adminMode: true });

  const [items, total] = await Promise.all([
    prisma.diamond.findMany({
      where,
      orderBy: buildDiamondOrderBy(q.sort),
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.diamond.count({ where }),
  ]);

  // For multi-ID search, compute "found N of M" so the user sees which of
  // their pasted IDs didn't match.
  let multiIdSummary: { searched: number; found: number; missing: string[] } | null = null;
  if (q.stoneIds.length > 1) {
    const foundIds = new Set(
      (await prisma.diamond.findMany({
        where: { stoneId: { in: q.stoneIds } },
        select: { stoneId: true },
      })).map(d => d.stoneId),
    );
    const missing = q.stoneIds.filter(id => !foundIds.has(id));
    multiIdSummary = { searched: q.stoneIds.length, found: foundIds.size, missing };
  }

  const exportHref = `/api/admin/diamonds/export?${sp.toString()}&filename=mahant-stock-${new Date().toISOString().slice(0,10)}.xlsx`;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <div>
          <h1 className="font-serif text-3xl">Stock</h1>
          <p className="text-sm text-brand-700">{total.toLocaleString()} stones match</p>
        </div>
        <div className="flex gap-2">
          <a href={exportHref} className="btn-outline">⬇ Download Excel</a>
          <Link href="/admin/upload" className="btn-primary">Upload Excel</Link>
        </div>
      </div>

      <FilterBar initial={{
        shape: q.shape, color: q.color, clarity: q.clarity,
        cut: q.cut, polish: q.polish, symmetry: q.symmetry,
        fluorescence: q.fluorescence, lab: q.lab,
        statusList: q.statusList,
        stoneIds: q.stoneIds, cert_no: q.cert_no,
        carat_min: q.carat_min?.toString() ?? '',
        carat_max: q.carat_max?.toString() ?? '',
        ppc_min:   q.ppc_min?.toString()   ?? '',
        ppc_max:   q.ppc_max?.toString()   ?? '',
      }} />

      {multiIdSummary && (
        <div className={`card p-3 text-sm ${
          multiIdSummary.missing.length > 0 ? 'border-amber-300 bg-amber-50/40' : 'border-emerald-300 bg-emerald-50/40'
        }`}>
          Searched <b>{multiIdSummary.searched}</b> stone IDs · Found <b>{multiIdSummary.found}</b>
          {multiIdSummary.missing.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-amber-800">
                {multiIdSummary.missing.length} not found
              </summary>
              <p className="font-mono text-xs mt-2 break-all">
                {multiIdSummary.missing.join(', ')}
              </p>
            </details>
          )}
        </div>
      )}

      <Pagination total={total} page={q.page} pageSize={q.pageSize}
                  basePath="/admin/diamonds" searchParams={sp} />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-brand-50 text-brand-700 text-left">
            <tr>
              <th className="px-3 py-2">Stone</th>
              <th className="px-3 py-2">Shape</th>
              <th className="px-3 py-2">Carat</th>
              <th className="px-3 py-2">Color</th>
              <th className="px-3 py-2">Clarity</th>
              <th className="px-3 py-2">Lab / Cert</th>
              <th className="px-3 py-2 text-right">$/ct</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map(d => (
              <tr key={d.id} className="border-t border-brand-100">
                <td className="px-3 py-2 font-mono text-xs">
                  <Link href={`/admin/diamonds/${d.id}`} className="text-gold-700 hover:underline">
                    {d.stoneId}
                  </Link>
                </td>
                <td className="px-3 py-2">{d.shape}</td>
                <td className="px-3 py-2">{fmtCarat(d.carat as any)}</td>
                <td className="px-3 py-2">{d.color}</td>
                <td className="px-3 py-2">{d.clarity}</td>
                <td className="px-3 py-2 text-xs">{d.lab} {d.certificateNo}</td>
                <td className="px-3 py-2 text-right">{fmtUsd(d.pricePerCarat as any)}</td>
                <td className="px-3 py-2 text-right">{fmtUsd(d.totalPrice as any)}</td>
                <td className="px-3 py-2"><StatusBadge status={d.status} /></td>
                <td className="px-3 py-2"><StatusActions diamondId={d.id} status={d.status} /></td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={10} className="text-center py-12 text-brand-700">No stones match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination total={total} page={q.page} pageSize={q.pageSize}
                  basePath="/admin/diamonds" searchParams={sp} />
    </div>
  );
}
