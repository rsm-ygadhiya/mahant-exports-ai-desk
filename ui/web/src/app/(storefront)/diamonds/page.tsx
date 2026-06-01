import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getCurrentCustomer } from '@/lib/session';
import { applyPricing } from '@/lib/pricing';
import { parseDiamondQuery, buildDiamondWhere, buildDiamondOrderBy } from '@/lib/diamondQuery';
import { fmtCarat } from '@/lib/format';
import { PriceCell } from '@/components/PriceCell';
import { StatusBadge } from '@/components/StatusBadge';
import { AddToCartButton } from '@/components/AddToCartButton';
import { Pagination } from '@/components/Pagination';
import { FilterBar } from './FilterBar';

export const dynamic = 'force-dynamic';

export default async function DiamondsPage({
  searchParams,
}: { searchParams: Record<string, string | string[] | undefined> }) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === 'string') sp.set(k, v);
    else if (Array.isArray(v) && v[0]) sp.set(k, v[0]);
  }
  const q = parseDiamondQuery(sp);
  const where = buildDiamondWhere(q);

  const customer = await getCurrentCustomer();

  const [items, total] = await Promise.all([
    prisma.diamond.findMany({
      where,
      orderBy: buildDiamondOrderBy(q.sort),
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.diamond.count({ where }),
  ]);

  const priced = items.map(d => applyPricing(d, customer, customer?.pricingRule ?? null));
  const signedIn = Boolean(customer);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-3xl">Available Stock</h1>
          <p className="text-sm text-brand-700">{total.toLocaleString()} stones match your filters</p>
        </div>
      </div>

      <FilterBar />

      <div className="card overflow-hidden mt-6">
        <table className="w-full text-sm">
          <thead className="bg-brand-50 text-brand-700 text-left">
            <tr>
              <th className="px-3 py-2">Stone</th>
              <th className="px-3 py-2">Shape</th>
              <th className="px-3 py-2">Carat</th>
              <th className="px-3 py-2">Color</th>
              <th className="px-3 py-2">Clarity</th>
              <th className="px-3 py-2">Cut</th>
              <th className="px-3 py-2">Lab</th>
              <th className="px-3 py-2">Cert No</th>
              <th className="px-3 py-2 text-right">$/ct</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Media</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {priced.map(d => (
              <tr key={d.id} className="border-t border-brand-100 hover:bg-brand-50/50">
                <td className="px-3 py-2 font-mono text-xs">
                  <Link href={`/diamonds/${d.id}`} className="text-brand-700 hover:text-gold-600">
                    {d.stoneId}
                  </Link>
                </td>
                <td className="px-3 py-2">{d.shape}</td>
                <td className="px-3 py-2">{fmtCarat(d.carat as any)}</td>
                <td className="px-3 py-2">{d.color}</td>
                <td className="px-3 py-2">{d.clarity}</td>
                <td className="px-3 py-2">{d.cut ?? '—'}</td>
                <td className="px-3 py-2">{d.lab ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-xs">{d.certificateNo ?? '—'}</td>
                <td className="px-3 py-2 text-right">
                  <PriceCell price={d.pricePerCarat as any} hidden={d.priceHidden} signedIn={signedIn} />
                </td>
                <td className="px-3 py-2 text-right">
                  <PriceCell price={d.totalPrice as any} hidden={d.priceHidden} signedIn={signedIn} />
                </td>
                <td className="px-3 py-2"><StatusBadge status={d.status} /></td>
                <td className="px-3 py-2">
                  <div className="flex gap-2 text-xs">
                    {d.videoUrl && <a href={d.videoUrl} target="_blank" rel="noreferrer"
                                      className="text-brand-700 hover:text-gold-600">▶ Video</a>}
                    {d.certificateUrl && <a href={d.certificateUrl} target="_blank" rel="noreferrer"
                                            className="text-brand-700 hover:text-gold-600">📄 Cert</a>}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  {d.status === 'AVAILABLE' && (
                    <AddToCartButton diamondId={d.id} signedIn={signedIn} compact />
                  )}
                </td>
              </tr>
            ))}
            {priced.length === 0 && (
              <tr><td colSpan={13} className="text-center py-12 text-brand-700">No stones match your filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination total={total} page={q.page} pageSize={q.pageSize}
                  basePath="/diamonds" searchParams={sp} />
    </div>
  );
}
