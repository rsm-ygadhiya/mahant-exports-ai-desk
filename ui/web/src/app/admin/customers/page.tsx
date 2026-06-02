import Link from 'next/link';
import { prisma } from '@/lib/db';
import { CustomerRow } from './CustomerRow';
import { getAllCustomers, type CanonicalTier } from '@/lib/csvCustomers';

export const dynamic = 'force-dynamic';

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const;
const KYC_STATUSES = ['NOT_SUBMITTED', 'SUBMITTED', 'MORE_DOCS_NEEDED', 'APPROVED', 'REJECTED'] as const;
const TIERS: CanonicalTier[] = ['Top', 'High', 'Mid', 'Low'];
const TIER_STYLE: Record<CanonicalTier, string> = {
  Top:  'bg-emerald-100 text-emerald-900',
  High: 'bg-sky-100      text-sky-900',
  Mid:  'bg-amber-100    text-amber-900',
  Low:  'bg-rose-100     text-rose-900',
};

export default async function AdminCustomersPage({
  searchParams,
}: { searchParams: { status?: string; kyc?: string; tier?: string } }) {
  const statusFilter = (STATUSES as readonly string[]).includes(searchParams.status ?? '')
    ? (searchParams.status as typeof STATUSES[number])
    : undefined;
  const kycFilter = (KYC_STATUSES as readonly string[]).includes(searchParams.kyc ?? '')
    ? (searchParams.kyc as typeof KYC_STATUSES[number])
    : undefined;

  const tierFilter = (TIERS as readonly string[]).includes(searchParams.tier ?? '')
    ? (searchParams.tier as CanonicalTier)
    : undefined;

  const [customers, clvCustomers] = await Promise.all([
    prisma.customer.findMany({
      where: {
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(kycFilter ? { kycStatus: kycFilter } : {}),
      },
      include: {
        pricingRule: true,
        _count: { select: { enquiries: true, documents: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    getAllCustomers(),
  ]);

  const filteredClv = tierFilter
    ? clvCustomers.filter(c => c.tier === tierFilter)
    : clvCustomers;
  const tierCounts: Record<CanonicalTier, number> = { Top: 0, High: 0, Mid: 0, Low: 0 };
  for (const c of clvCustomers) tierCounts[c.tier]++;

  const linkFor = (next: { status?: string; kyc?: string; tier?: string }) => {
    const params = new URLSearchParams();
    const finalStatus = next.status !== undefined ? next.status : statusFilter;
    const finalKyc    = next.kyc    !== undefined ? next.kyc    : kycFilter;
    const finalTier   = next.tier   !== undefined ? next.tier   : tierFilter;
    if (finalStatus) params.set('status', String(finalStatus));
    if (finalKyc)    params.set('kyc',    String(finalKyc));
    if (finalTier)   params.set('tier',   String(finalTier));
    const qs = params.toString();
    return qs ? `/admin/customers?${qs}` : '/admin/customers';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-3xl">Customers</h1>
        <Link href="/admin/customers/new" className="btn-primary">＋ New customer</Link>
      </div>

      <div className="card p-3 space-y-2 text-sm">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs uppercase tracking-widest text-brand-700 mr-1">Account:</span>
          <Link href={linkFor({ status: '' })} className={!statusFilter ? 'btn-primary' : 'btn-outline'}>All</Link>
          {STATUSES.map(s => (
            <Link key={s} href={linkFor({ status: s })}
                  className={statusFilter === s ? 'btn-primary' : 'btn-outline'}>{s}</Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs uppercase tracking-widest text-brand-700 mr-1">KYC:</span>
          <Link href={linkFor({ kyc: '' })} className={!kycFilter ? 'btn-primary' : 'btn-outline'}>All</Link>
          {KYC_STATUSES.map(s => (
            <Link key={s} href={linkFor({ kyc: s })}
                  className={kycFilter === s ? 'btn-primary' : 'btn-outline'}>{s.replace('_', ' ')}</Link>
          ))}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-brand-50 text-brand-700 text-left">
            <tr>
              <th className="px-3 py-2">Customer ID</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Contact</th>
              <th className="px-3 py-2">Mobile / Email</th>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">KYC</th>
              <th className="px-3 py-2">Pricing</th>
              <th className="px-3 py-2 text-right">Docs</th>
              <th className="px-3 py-2 text-right">Enquiries</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {customers.map(c => <CustomerRow key={c.id} customer={c as any} />)}
            {customers.length === 0 && (
              <tr><td colSpan={10} className="text-center py-12 text-brand-700">No customers match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* CLV customers (from analytics CSV seeds) */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <h2 className="font-serif text-2xl">CLV-tracked accounts</h2>
            <p className="text-xs text-brand-700/70">
              Sourced from the analytics seeds. Click any row to see their CLV, order history,
              and payment history.
            </p>
          </div>
          <div className="text-xs text-brand-700">
            {clvCustomers.length} total · click a tier chip below to filter
          </div>
        </div>

        <div className="card p-3 flex flex-wrap gap-2 items-center text-sm">
          <span className="text-xs uppercase tracking-widest text-brand-700 mr-1">Tier:</span>
          <Link
            href={linkFor({ tier: '' })}
            className={!tierFilter ? 'btn-primary' : 'btn-outline'}
          >All ({clvCustomers.length})</Link>
          {TIERS.map(t => (
            <Link
              key={t}
              href={linkFor({ tier: t })}
              className={tierFilter === t ? 'btn-primary' : 'btn-outline'}
            >
              {t} ({tierCounts[t]})
            </Link>
          ))}
        </div>

        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-brand-50 text-brand-700 text-left">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Market</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Tier</th>
                <th className="px-3 py-2 text-right">Risk-adj CLV</th>
                <th className="px-3 py-2 text-right">Annual spend</th>
                <th className="px-3 py-2 text-right">Pay score</th>
                <th className="px-3 py-2 text-right">Churn %</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filteredClv.map(c => (
                <tr key={c.customer_id} className="border-t border-brand-50 hover:bg-brand-50/40">
                  <td className="px-3 py-1.5 font-mono text-brand-700">{c.customer_id}</td>
                  <td className="px-3 py-1.5">
                    <Link href={`/admin/customers/clv/${c.customer_id}`} className="text-brand-900 hover:underline">
                      {c.customer_name}
                    </Link>
                    {c.is_broker && <span className="ml-1.5 text-[10px] bg-violet-100 text-violet-900 px-1 rounded">Broker</span>}
                  </td>
                  <td className="px-3 py-1.5 text-brand-700">{c.customer_type}</td>
                  <td className="px-3 py-1.5 text-brand-700">{c.market}</td>
                  <td className="px-3 py-1.5 text-brand-700">{c.relationship_owner}</td>
                  <td className="px-3 py-1.5">
                    <span className={`text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded ${TIER_STYLE[c.tier]}`}>{c.tier}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">${c.risk_adjusted_clv.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-brand-700">${c.annual_spend.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-brand-700">{c.payment_score}</td>
                  <td className={`px-3 py-1.5 text-right font-mono ${c.churn_risk_pct >= 40 ? 'text-rose-700' : c.churn_risk_pct >= 25 ? 'text-amber-700' : 'text-brand-700'}`}>
                    {c.churn_risk_pct.toFixed(0)}%
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Link href={`/admin/customers/clv/${c.customer_id}`} className="text-xs text-brand-900 hover:underline">Open →</Link>
                  </td>
                </tr>
              ))}
              {filteredClv.length === 0 && (
                <tr><td colSpan={11} className="text-center py-8 text-brand-700 italic">No CLV customers match this tier.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
