import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getCustomer,
  getCustomerTransactions,
  getCustomerPayments,
  type CanonicalTier,
} from '@/lib/csvCustomers';

export const dynamic = 'force-dynamic';

const TIER_STYLE: Record<CanonicalTier, string> = {
  Top:  'bg-emerald-100 text-emerald-900 border-emerald-200',
  High: 'bg-sky-100      text-sky-900      border-sky-200',
  Mid:  'bg-amber-100    text-amber-900    border-amber-200',
  Low:  'bg-rose-100     text-rose-900     border-rose-200',
};

function money(n: number) {
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function pct(n: number, digits = 1) {
  return n.toFixed(digits) + '%';
}

export default async function ClvCustomerDetail({ params }: { params: { id: string } }) {
  const customer = await getCustomer(params.id);
  if (!customer) notFound();

  const [txns, pays] = await Promise.all([
    getCustomerTransactions(customer.customer_id),
    getCustomerPayments(customer.customer_id),
  ]);

  // Top categories by total spend
  const catTotals = new Map<string, { count: number; total: number }>();
  for (const t of txns) {
    const cur = catTotals.get(t.category_simple) ?? { count: 0, total: 0 };
    cur.count += 1; cur.total += t.sold_price;
    catTotals.set(t.category_simple, cur);
  }
  const topCategories = Array.from(catTotals.entries())
    .sort((a, b) => b[1].total - a[1].total).slice(0, 5);

  const totalSpend = txns.reduce((s, t) => s + t.sold_price, 0);
  const totalProfit = txns.reduce((s, t) => s + t.gross_profit, 0);
  const onTimeRate = pays.length === 0 ? 0
    : (pays.filter(p => p.days_early_late <= 0).length / pays.length) * 100;
  const lateCount = pays.filter(p => p.late_incident_flag === 'true' || p.days_early_late > 0).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link href="/admin/customers" className="text-xs text-brand-700 hover:text-brand-900">← Customers</Link>
          <h1 className="font-serif text-3xl mt-1">{customer.customer_name}</h1>
          <div className="text-sm text-brand-700">
            {customer.customer_id} · {customer.customer_type} · {customer.market}
            {customer.is_broker && <span className="ml-2 text-xs bg-violet-100 text-violet-900 px-1.5 py-0.5 rounded">Broker</span>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs uppercase tracking-widest px-2.5 py-1 rounded border ${TIER_STYLE[customer.tier]}`}>
            {customer.tier} CLV
          </span>
          <span className={`text-xs uppercase tracking-widest px-2.5 py-1 rounded border
            ${customer.active_status === 'Active'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : 'bg-brand-50 text-brand-700 border-brand-200'}`}>
            {customer.active_status}
          </span>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Risk-adjusted CLV" value={money(customer.risk_adjusted_clv)} hint={`Raw: ${money(customer.raw_clv)}`} />
        <Kpi label="Annual spend"      value={money(customer.annual_spend)}      hint={`Avg order: ${money(customer.avg_order_value)}`} />
        <Kpi label="Churn risk"        value={pct(customer.churn_risk_pct, 0)}  hint={`Lifespan: ${customer.account_lifespan_years.toFixed(1)} yrs`} />
        <Kpi label="Payment score"     value={`${customer.payment_score}/100`}  hint={`${customer.payment_terms} · on-time ${pct(onTimeRate, 0)}`} />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Profile column */}
        <div className="card p-4 space-y-3 lg:col-span-1">
          <div className="text-xs uppercase tracking-widest text-brand-700">Profile</div>
          <ProfileRow k="Customer ID"     v={customer.customer_id} />
          <ProfileRow k="Company"          v={customer.customer_name} />
          <ProfileRow k="Type"             v={customer.customer_type} />
          <ProfileRow k="Market"           v={customer.market} />
          <ProfileRow k="Owned by"         v={customer.relationship_owner} />
          <ProfileRow k="Joined"           v={customer.join_date} />
          <ProfileRow k="Broker ID"        v={customer.broker_id || '—'} />
          <ProfileRow k="Payment terms"    v={`${customer.payment_terms} (${customer.payment_terms_days}d)`} />
          <ProfileRow k="Purchase freq"    v={`${customer.purchase_frequency}/yr`} />
          <ProfileRow k="Gross margin"     v={pct(customer.gross_margin_pct)} />

          <div className="pt-2 border-t border-brand-100">
            <div className="text-xs uppercase tracking-widest text-brand-700 mb-2">Top categories</div>
            {topCategories.length === 0 ? (
              <div className="text-xs text-brand-700/70 italic">No transactions yet.</div>
            ) : (
              <ul className="space-y-1 text-xs">
                {topCategories.map(([cat, info]) => (
                  <li key={cat} className="flex justify-between gap-2">
                    <span className="truncate">{cat}</span>
                    <span className="font-mono text-brand-700">{info.count}× · {money(info.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Order history */}
        <div className="card p-0 overflow-hidden lg:col-span-2">
          <div className="px-4 py-3 flex items-center justify-between border-b border-brand-100">
            <div>
              <div className="text-xs uppercase tracking-widest text-brand-700">Order history</div>
              <div className="text-xs text-brand-700/70">
                {txns.length} transaction{txns.length === 1 ? '' : 's'} · {money(totalSpend)} total · {money(totalProfit)} gross profit
              </div>
            </div>
          </div>
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-brand-50 text-brand-700 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Stone</th>
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-right">Sold</th>
                  <th className="px-3 py-2 text-right">$/ct</th>
                  <th className="px-3 py-2 text-right">GP</th>
                  <th className="px-3 py-2 text-left">Invoice</th>
                  <th className="px-3 py-2 text-left">Pay</th>
                </tr>
              </thead>
              <tbody>
                {txns.map(t => (
                  <tr key={t.transaction_id} className="border-t border-brand-50">
                    <td className="px-3 py-1.5 font-mono text-brand-700">{t.transaction_date}</td>
                    <td className="px-3 py-1.5 font-mono">{t.stock_id}</td>
                    <td className="px-3 py-1.5 truncate max-w-[220px]" title={t.category_simple}>{t.category_simple}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{money(t.sold_price)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-brand-700">{money(t.sold_ppc)}</td>
                    <td className={`px-3 py-1.5 text-right font-mono ${t.gross_profit < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                      {money(t.gross_profit)}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-brand-700">{t.invoice_id}</td>
                    <td className="px-3 py-1.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded
                        ${t.payment_status === 'Paid'    ? 'bg-emerald-100 text-emerald-900'
                        : t.payment_status === 'Partial' ? 'bg-amber-100 text-amber-900'
                        : t.payment_status === 'Advance' ? 'bg-sky-100 text-sky-900'
                        : t.payment_status === 'Overdue' ? 'bg-rose-100 text-rose-900'
                        : 'bg-brand-50 text-brand-700'}`}>
                        {t.payment_status}
                      </span>
                    </td>
                  </tr>
                ))}
                {txns.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-6 text-brand-700 italic">No transactions on file.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Payment history */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between border-b border-brand-100">
          <div>
            <div className="text-xs uppercase tracking-widest text-brand-700">Payment history</div>
            <div className="text-xs text-brand-700/70">
              {pays.length} payment{pays.length === 1 ? '' : 's'} · {pct(onTimeRate, 0)} on-time · {lateCount} late incident{lateCount === 1 ? '' : 's'}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-brand-50 text-brand-700 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left">Invoice</th>
                <th className="px-3 py-2 text-left">Order</th>
                <th className="px-3 py-2 text-left">Invoice date</th>
                <th className="px-3 py-2 text-left">Due date</th>
                <th className="px-3 py-2 text-left">Paid on</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-right">Δ days</th>
                <th className="px-3 py-2 text-left">Behavior</th>
              </tr>
            </thead>
            <tbody>
              {pays.map(p => (
                <tr key={p.payment_id} className="border-t border-brand-50">
                  <td className="px-3 py-1.5 font-mono text-brand-700">{p.invoice_id}</td>
                  <td className="px-3 py-1.5 font-mono text-brand-700">{p.order_id}</td>
                  <td className="px-3 py-1.5 font-mono">{p.invoice_date}</td>
                  <td className="px-3 py-1.5 font-mono">{p.due_date}</td>
                  <td className="px-3 py-1.5 font-mono">{p.payment_date || '—'}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{money(p.payment_amount)}</td>
                  <td className={`px-3 py-1.5 text-right font-mono
                    ${p.days_early_late > 0 ? 'text-rose-700'
                    : p.days_early_late < 0 ? 'text-emerald-700'
                    : 'text-brand-700'}`}>
                    {p.days_early_late > 0 ? `+${p.days_early_late}` : p.days_early_late}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded
                      ${p.payment_behavior_label === 'Early'  ? 'bg-emerald-100 text-emerald-900'
                      : p.payment_behavior_label === 'On Time' ? 'bg-sky-100 text-sky-900'
                      : p.payment_behavior_label === 'Late'    ? 'bg-amber-100 text-amber-900'
                      : 'bg-rose-100 text-rose-900'}`}>
                      {p.payment_behavior_label || '—'}
                    </span>
                  </td>
                </tr>
              ))}
              {pays.length === 0 && (
                <tr><td colSpan={8} className="text-center py-6 text-brand-700 italic">No payments on file.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-3">
      <div className="text-[10px] uppercase tracking-widest text-brand-700">{label}</div>
      <div className="font-serif text-2xl mt-1">{value}</div>
      {hint && <div className="text-xs text-brand-700/70 mt-0.5">{hint}</div>}
    </div>
  );
}

function ProfileRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2 text-xs">
      <span className="text-brand-700">{k}</span>
      <span className="text-brand-900 font-mono text-right">{v}</span>
    </div>
  );
}
