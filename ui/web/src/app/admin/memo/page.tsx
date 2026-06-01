import Link from 'next/link';
import { prisma } from '@/lib/db';
import { fmtCarat, fmtUsd } from '@/lib/format';
import { Card, StatusBar, Donut } from '@/components/admin/Charts';
import { Pagination } from '@/components/Pagination';
import { StatusActions } from '../diamonds/StatusActions';

export const dynamic = 'force-dynamic';

const where = { status: 'HOLD' as const };

export default async function MemoPage({
  searchParams,
}: { searchParams: Record<string, string | string[] | undefined> }) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === 'string') sp.set(k, v);
  }
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const pageSize = Math.min(500, Math.max(10, Number(sp.get('pageSize')) || 50));

  const [items, total, valueAgg, byShape] = await Promise.all([
    prisma.diamond.findMany({
      where,
      orderBy: { updatedAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.diamond.count({ where }),
    prisma.diamond.aggregate({ where, _sum: { totalPrice: true, carat: true } }),
    prisma.diamond.groupBy({ by: ['shape'], where, _count: { _all: true }, orderBy: { _count: { shape: 'desc' } }, take: 8 }),
  ]);

  // Bucketed "days on memo" — flag stale holds. Use ALL holds for the chart,
  // not just the current page, so the chart isn't misleading.
  const allHolds = await prisma.diamond.findMany({ where, select: { updatedAt: true } });
  const now = Date.now();
  const ageBuckets = [
    { name: '< 1 day', min: 0, max: 1 },
    { name: '1–3 days', min: 1, max: 3 },
    { name: '3–7 days', min: 3, max: 7 },
    { name: '1–2 wks', min: 7, max: 14 },
    { name: '2+ wks', min: 14, max: Infinity },
  ];
  const ageData = ageBuckets.map(b => ({
    name: b.name,
    value: allHolds.filter(i => {
      const days = (now - i.updatedAt.getTime()) / 86_400_000;
      return days >= b.min && days < b.max;
    }).length,
  }));

  const exportHref = `/api/admin/diamonds/export?status=HOLD&filename=mahant-memo-${new Date().toISOString().slice(0,10)}.xlsx&sheet=Memo`;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">On Memo</h1>
          <p className="text-sm text-brand-700">{total.toLocaleString()} stones currently on hold</p>
        </div>
        <a href={exportHref} className="btn-gold">⬇ Download Excel</a>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <KpiCard label="Stones on memo" value={total.toLocaleString()} tone="amber" />
        <KpiCard label="Reserved value" value={fmtUsd(valueAgg._sum.totalPrice as any)} tone="amber" />
        <KpiCard label="Total carat" value={Number(valueAgg._sum.carat ?? 0).toFixed(2)} tone="amber" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="How long on memo" subtitle="Identify stale holds (all stones)">
          <StatusBar data={ageData} />
        </Card>
        <Card title="By shape" subtitle="Most-reserved shapes">
          <Donut data={byShape.map(s => ({ name: s.shape, value: s._count._all }))} />
        </Card>
      </div>

      <Pagination total={total} page={page} pageSize={pageSize}
                  basePath="/admin/memo" searchParams={sp} />

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
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">On hold for</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map(d => {
              const days = Math.floor((now - d.updatedAt.getTime()) / 86_400_000);
              const stale = days >= 7;
              return (
                <tr key={d.id} className={`border-t border-brand-100 ${stale ? 'bg-rose-50/30' : ''}`}>
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`/admin/diamonds/${d.id}`} className="text-gold-700 hover:underline">{d.stoneId}</Link>
                  </td>
                  <td className="px-3 py-2">{d.shape}</td>
                  <td className="px-3 py-2">{fmtCarat(d.carat as any)}</td>
                  <td className="px-3 py-2">{d.color}</td>
                  <td className="px-3 py-2">{d.clarity}</td>
                  <td className="px-3 py-2 text-xs">{d.lab} {d.certificateNo}</td>
                  <td className="px-3 py-2 text-right">{fmtUsd(d.totalPrice as any)}</td>
                  <td className="px-3 py-2 text-xs">
                    {days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`}
                    {stale && <span className="ml-1 badge-red">stale</span>}
                  </td>
                  <td className="px-3 py-2"><StatusActions diamondId={d.id} status="HOLD" /></td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr><td colSpan={9} className="text-center py-12 text-brand-700">No stones on memo right now.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination total={total} page={page} pageSize={pageSize}
                  basePath="/admin/memo" searchParams={sp} />
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
