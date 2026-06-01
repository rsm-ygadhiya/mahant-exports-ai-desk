import Link from 'next/link';
import { prisma } from '@/lib/db';
import { fmtCarat, fmtUsd } from '@/lib/format';
import { Card, StatusBar, Donut } from '@/components/admin/Charts';
import { Pagination } from '@/components/Pagination';

export const dynamic = 'force-dynamic';

export default async function SoldPage({
  searchParams,
}: { searchParams: Record<string, string | string[] | undefined> }) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === 'string') sp.set(k, v);
  }
  const days = Number(sp.get('days')) || 0;
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const pageSize = Math.min(500, Math.max(10, Number(sp.get('pageSize')) || 50));
  const since = days > 0 ? new Date(Date.now() - days * 86_400_000) : null;
  const where = {
    status: 'SOLD' as const,
    ...(since ? { updatedAt: { gte: since } } : {}),
  };

  const [items, total, valueAgg, byShape, byMonthRaw] = await Promise.all([
    prisma.diamond.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.diamond.count({ where }),
    prisma.diamond.aggregate({ where, _sum: { totalPrice: true, carat: true } }),
    prisma.diamond.groupBy({ by: ['shape'], where, _count: { _all: true }, orderBy: { _count: { shape: 'desc' } }, take: 8 }),
    prisma.diamond.findMany({ where, select: { updatedAt: true, totalPrice: true } }),
  ]);

  // Build a 12-month sales trend.
  const buckets: Array<{ label: string; count: number; revenue: number }> = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ label: d.toLocaleString('en-US', { month: 'short' }), count: 0, revenue: 0 });
  }
  for (const r of byMonthRaw) {
    const m = r.updatedAt.getMonth();
    const yearDiff = (now.getFullYear() - r.updatedAt.getFullYear()) * 12;
    const monthsAgo = yearDiff + (now.getMonth() - m);
    if (monthsAgo >= 0 && monthsAgo < 12) {
      const idx = 11 - monthsAgo;
      buckets[idx].count++;
      buckets[idx].revenue += Number(r.totalPrice);
    }
  }

  const exportHref = `/api/admin/diamonds/export?status=SOLD${since ? `&since=${since.toISOString()}` : ''}&filename=mahant-sold-${new Date().toISOString().slice(0,10)}.xlsx&sheet=Sold`;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Sold</h1>
          <p className="text-sm text-brand-700">{total.toLocaleString()} stones sold {since ? `in last ${days} days` : 'all-time'}</p>
        </div>
        <a href={exportHref} className="btn-gold">⬇ Download Excel</a>
      </div>

      <div className="flex gap-2 text-sm">
        {[
          { label: 'All', d: 0 }, { label: '7d', d: 7 }, { label: '30d', d: 30 }, { label: '90d', d: 90 }, { label: '12m', d: 365 },
        ].map(o => (
          <Link key={o.label} href={`/admin/sold${o.d ? `?days=${o.d}` : ''}`}
                className={(days || 0) === o.d ? 'btn-primary' : 'btn-outline'}>
            {o.label}
          </Link>
        ))}
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <KpiCard label="Stones sold" value={total.toLocaleString()} tone="rose" />
        <KpiCard label="Total revenue" value={fmtUsd(valueAgg._sum.totalPrice as any)} tone="rose" />
        <KpiCard label="Total carat" value={Number(valueAgg._sum.carat ?? 0).toFixed(2)} tone="rose" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Sales — last 12 months" subtitle="Stones sold per month">
          <StatusBar data={buckets.map(b => ({ name: b.label, value: b.count }))} />
        </Card>
        <Card title="Sold by shape" subtitle="What's moving">
          <Donut data={byShape.map(s => ({ name: s.shape, value: s._count._all }))} />
        </Card>
      </div>

      <Pagination total={total} page={page} pageSize={pageSize}
                  basePath="/admin/sold" searchParams={sp} />

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
              <th className="px-3 py-2">Sold</th>
            </tr>
          </thead>
          <tbody>
            {items.map(d => (
              <tr key={d.id} className="border-t border-brand-100">
                <td className="px-3 py-2 font-mono text-xs">
                  <Link href={`/admin/diamonds/${d.id}`} className="text-gold-700 hover:underline">{d.stoneId}</Link>
                </td>
                <td className="px-3 py-2">{d.shape}</td>
                <td className="px-3 py-2">{fmtCarat(d.carat as any)}</td>
                <td className="px-3 py-2">{d.color}</td>
                <td className="px-3 py-2">{d.clarity}</td>
                <td className="px-3 py-2 text-xs">{d.lab} {d.certificateNo}</td>
                <td className="px-3 py-2 text-right">{fmtUsd(d.pricePerCarat as any)}</td>
                <td className="px-3 py-2 text-right font-medium">{fmtUsd(d.totalPrice as any)}</td>
                <td className="px-3 py-2 text-xs">{new Date(d.updatedAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={9} className="text-center py-12 text-brand-700">No sales in this window.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination total={total} page={page} pageSize={pageSize}
                  basePath="/admin/sold" searchParams={sp} />
    </div>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'amber' | 'rose' }) {
  const cls = tone === 'green' ? 'text-emerald-700'
            : tone === 'amber' ? 'text-amber-700'
            : tone === 'rose'  ? 'text-rose-700'
            : 'text-brand-900';
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-widest text-brand-700">{label}</div>
      <div className={`text-3xl font-serif mt-1 ${cls}`}>{value}</div>
    </div>
  );
}
