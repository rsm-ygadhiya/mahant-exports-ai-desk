import Link from 'next/link';
import { prisma } from '@/lib/db';
import { fmtUsd } from '@/lib/format';
import { Card, StatusBar, Donut, TrendLine, COLORS } from '@/components/admin/Charts';

export const dynamic = 'force-dynamic';

export default async function AdminDashboard() {
  // ── headline counts ──
  const [
    total, available, hold, sold, customers, pending,
    enquiriesNew, enquiriesAll, lastUpload,
  ] = await Promise.all([
    prisma.diamond.count(),
    prisma.diamond.count({ where: { status: 'AVAILABLE' } }),
    prisma.diamond.count({ where: { status: 'HOLD' } }),
    prisma.diamond.count({ where: { status: 'SOLD' } }),
    prisma.customer.count(),
    prisma.customer.count({ where: { status: 'PENDING' } }),
    prisma.enquiry.count({ where: { status: 'NEW' } }),
    prisma.enquiry.count(),
    prisma.stockUpload.findFirst({ orderBy: { createdAt: 'desc' } }),
  ]);

  // ── values ──
  const [availValueAgg, soldValueAgg, holdValueAgg] = await Promise.all([
    prisma.diamond.aggregate({ where: { status: 'AVAILABLE' }, _sum: { totalPrice: true } }),
    prisma.diamond.aggregate({ where: { status: 'SOLD' },      _sum: { totalPrice: true } }),
    prisma.diamond.aggregate({ where: { status: 'HOLD' },      _sum: { totalPrice: true } }),
  ]);

  // ── chart data ──
  const stockByStatusData = [
    { name: 'Available', value: available },
    { name: 'On Hold', value: hold },
    { name: 'Sold', value: sold },
  ];

  const byShapeRaw = await prisma.diamond.groupBy({
    by: ['shape'], _count: { _all: true },
    orderBy: { _count: { shape: 'desc' } },
    take: 8,
  });
  const shapeData = byShapeRaw.map(r => ({ name: r.shape, value: r._count._all }));

  // Price-band histogram (per-carat).
  const allPpc = await prisma.diamond.findMany({
    where: { status: 'AVAILABLE' },
    select: { pricePerCarat: true },
  });
  const bands = [
    { name: '<$500',     min: 0,    max: 500 },
    { name: '$500-1k',   min: 500,  max: 1000 },
    { name: '$1k-2k',    min: 1000, max: 2000 },
    { name: '$2k-3k',    min: 2000, max: 3000 },
    { name: '$3k-5k',    min: 3000, max: 5000 },
    { name: '$5k+',      min: 5000, max: Infinity },
  ];
  const priceBandData = bands.map(b => ({
    name: b.name,
    value: allPpc.filter(d => {
      const v = Number(d.pricePerCarat);
      return v >= b.min && v < b.max;
    }).length,
  }));

  // Customer mix.
  const customerMixRaw = await prisma.customer.groupBy({
    by: ['status'], _count: { _all: true },
  });
  const customerMixData = customerMixRaw.map(r => ({ name: r.status, value: r._count._all }));

  // Enquiries — last 30 days (per day).
  const since = new Date(); since.setDate(since.getDate() - 29);
  const recentEnquiries = await prisma.enquiry.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true },
  });
  const dayMap = new Map<string, number>();
  for (let i = 0; i < 30; i++) {
    const d = new Date(since); d.setDate(since.getDate() + i);
    dayMap.set(d.toISOString().slice(5, 10), 0);
  }
  for (const e of recentEnquiries) {
    const k = e.createdAt.toISOString().slice(5, 10);
    if (dayMap.has(k)) dayMap.set(k, dayMap.get(k)! + 1);
  }
  const enquiryTrend = Array.from(dayMap.entries()).map(([label, value]) => ({ label, value }));

  // ── top stat tiles ──
  const tiles: Array<{ label: string; value: string; sub?: string; href?: string; tone?: 'green' | 'amber' | 'red' }> = [
    { label: 'Available', value: available.toLocaleString(), sub: fmtUsd(availValueAgg._sum.totalPrice as any), href: '/admin/diamonds?status=AVAILABLE', tone: 'green' },
    { label: 'On Memo', value: hold.toLocaleString(), sub: fmtUsd(holdValueAgg._sum.totalPrice as any), href: '/admin/memo', tone: 'amber' },
    { label: 'Sold', value: sold.toLocaleString(), sub: fmtUsd(soldValueAgg._sum.totalPrice as any), href: '/admin/sold', tone: 'red' },
    { label: 'Total stones', value: total.toLocaleString(), href: '/admin/diamonds' },
    { label: 'Customers', value: customers.toLocaleString(), sub: `${pending} pending approval`, href: '/admin/customers' },
    { label: 'New enquiries', value: enquiriesNew.toLocaleString(), sub: `${enquiriesAll} all-time`, href: '/admin/enquiries', tone: 'amber' },
  ];

  return (
    <div className="space-y-8">
      <h1 className="font-serif text-3xl">Dashboard</h1>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {tiles.map(t => {
          const inner = (
            <div className="card p-4 hover:shadow-md transition">
              <div className="text-xs uppercase tracking-widest text-brand-700">{t.label}</div>
              <div className={`text-2xl font-serif mt-1 ${
                t.tone === 'green' ? 'text-emerald-700'
                : t.tone === 'amber' ? 'text-amber-700'
                : t.tone === 'red'   ? 'text-rose-700'
                : 'text-brand-900'
              }`}>{t.value}</div>
              {t.sub && <div className="text-xs text-brand-700 mt-1">{t.sub}</div>}
            </div>
          );
          return t.href ? <Link key={t.label} href={t.href}>{inner}</Link> : <div key={t.label}>{inner}</div>;
        })}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="Stock by status">
          <Donut data={stockByStatusData.filter(d => d.value > 0)} />
        </Card>

        <Card title="Top shapes" subtitle="By stone count">
          <StatusBar data={shapeData} />
        </Card>

        <Card title="Customer mix" subtitle="By approval status">
          <Donut data={customerMixData.filter(d => d.value > 0)} />
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Available stock by $/ct band" subtitle="Pricing distribution">
          <StatusBar data={priceBandData} />
        </Card>
        <Card title="Enquiries — last 30 days" subtitle={`${recentEnquiries.length} total`}>
          <TrendLine data={enquiryTrend} />
        </Card>
      </div>

      <div className="grid lg:grid-cols-4 gap-4">
        <Link href="/admin/ai/briefing" className="card p-6 hover:shadow-md transition bg-gradient-to-br from-brand-700 to-brand-900 text-white">
          <div className="text-xs uppercase tracking-widest text-gold-400 mb-1">✨ AI</div>
          <div className="font-serif text-lg">Morning briefing →</div>
          <p className="text-xs text-brand-100 mt-1">Today's priority list.</p>
        </Link>
        <Link href="/admin/pricing" className="card p-6 hover:shadow-md transition">
          <div className="text-xs uppercase tracking-widest text-gold-600 mb-1">💎 Pricing</div>
          <div className="font-serif text-lg">Run weekly reprice →</div>
          <p className="text-xs text-brand-700 mt-1">Rap upload, propose, approve, push.</p>
        </Link>
        <Link href="/admin/upload" className="card p-6 hover:shadow-md transition">
          <div className="text-xs uppercase tracking-widest text-gold-600 mb-1">Stock</div>
          <div className="font-serif text-lg">Upload from Excel →</div>
        </Link>
        <Link href="/admin/customers/new" className="card p-6 hover:shadow-md transition">
          <div className="text-xs uppercase tracking-widest text-gold-600 mb-1">Customers</div>
          <div className="font-serif text-lg">Create buyer account →</div>
        </Link>
      </div>

      {lastUpload && (
        <div className="card p-4">
          <div className="text-xs uppercase tracking-widest text-brand-700 mb-1">Last Excel upload</div>
          <div className="text-sm">
            <span className="font-mono">{lastUpload.filename}</span>{' '}
            · {new Date(lastUpload.createdAt).toLocaleString()}{' '}
            · {lastUpload.rowsCreated} created, {lastUpload.rowsUpdated} updated, {lastUpload.rowsFailed} failed
          </div>
        </div>
      )}
    </div>
  );
}
