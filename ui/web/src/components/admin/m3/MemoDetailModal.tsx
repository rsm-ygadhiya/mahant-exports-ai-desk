'use client';
import { useEffect, useState } from 'react';

type Detail = {
  memo: Record<string, string>;
  stone: Record<string, string> | null;
  customer: Record<string, string> | null;
  broker: Record<string, string> | null;
  decision: Record<string, string> | null;
  conflicts: Array<{
    memo_id: string;
    customer_id: string;
    decision: string;
    request_date: string;
    closed_outcome: string;
  }>;
  recent_pays: Array<{
    invoice_id: string;
    due_date: string;
    payment_date: string;
    days_early_late: string;
    payment_behavior_label: string;
  }>;
};

/**
 * Slide-from-right modal showing the full picture behind one memo:
 * memo facts, the stone being requested, the customer (CLV tier,
 * payment behaviour, churn risk), the broker (if any), the
 * Scintilla decision + rationale, and any other memos touching the
 * same stone.
 *
 * The Approve / Reject buttons inside the modal call back through
 * the same `onDecide` prop that the inline SignoffCard uses, so the
 * "sent draft" toast and the fade-out of the source card stay
 * consistent.
 */
export function MemoDetailModal({
  memoId,
  onClose,
  onDecide,
  showActions,
}: {
  memoId: string;
  onClose: () => void;
  onDecide?: (verdict: 'approved' | 'rejected') => void;
  showActions: boolean;
}) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/admin/scintilla/memo/${encodeURIComponent(memoId)}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(json.error ?? 'failed to load memo');
        else setData(json as Detail);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'failed to load memo');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [memoId]);

  // ESC to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex" onClick={onClose}>
      <div className="ml-auto h-full w-full max-w-3xl bg-white shadow-2xl overflow-y-auto"
           onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b px-5 py-3 flex items-center justify-between z-10">
          <div className="font-serif text-xl text-brand-900">
            📝 Memo detail
            <span className="ml-3 text-xs font-mono text-brand-700">{memoId}</span>
          </div>
          <button onClick={onClose}
                  className="text-brand-700 hover:text-rose-700 text-lg">×</button>
        </div>

        <div className="p-5 space-y-4">
          {busy && (
            <div className="card p-6 text-center text-brand-700 animate-pulse">
              ⏳ Loading memo, stone, and customer detail…
            </div>
          )}

          {error && (
            <div className="card p-4 bg-rose-50/40 border-rose-300 text-sm text-rose-800">
              {error}
            </div>
          )}

          {data && (
            <>
              <DecisionPanel d={data} />
              <StonePanel s={data.stone} />
              <CustomerPanel c={data.customer} kind="customer" />
              {data.broker && <CustomerPanel c={data.broker} kind="broker" />}
              {data.conflicts.length > 0 && <ConflictsPanel rows={data.conflicts} />}
              {data.recent_pays.length > 0 && <PaymentsPanel rows={data.recent_pays} />}
              <MemoPanel m={data.memo} />
            </>
          )}
        </div>

        {showActions && onDecide && data && (
          <div className="sticky bottom-0 bg-white border-t px-5 py-3 flex items-center gap-2 justify-end">
            <button onClick={() => { onDecide('rejected'); onClose(); }}
                    className="px-4 py-2 rounded bg-rose-600 text-white text-sm hover:bg-rose-700">
              ❌ Reject &amp; send decline
            </button>
            <button onClick={() => { onDecide('approved'); onClose(); }}
                    className="px-4 py-2 rounded bg-emerald-600 text-white text-sm hover:bg-emerald-700">
              ✅ Approve &amp; send memo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────── Panel components ───────────

function DecisionPanel({ d }: { d: Detail }) {
  const dec = d.decision;
  if (!dec) {
    return (
      <Panel title="✦ Scintilla decision" tone="brand">
        <div className="text-sm text-brand-700">
          No decision rendered yet — run Scintilla to populate.
        </div>
      </Panel>
    );
  }
  const queueCls =
    dec.queue === 'auto_approve' ? 'bg-emerald-100 text-emerald-700'
  : dec.queue === 'auto_reject'  ? 'bg-rose-100 text-rose-700'
  :                                 'bg-amber-100 text-amber-800';
  const decCls =
    dec.decision === 'APPROVE' ? 'bg-emerald-50 text-emerald-700'
  : dec.decision === 'REJECT'  ? 'bg-rose-50 text-rose-700'
  :                               'bg-amber-50 text-amber-800';
  return (
    <Panel title="✦ Scintilla decision" tone="brand">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className={`text-xs px-2 py-0.5 rounded ${queueCls}`}>{dec.queue}</span>
        <span className={`text-xs px-2 py-0.5 rounded ${decCls}`}>{dec.decision}</span>
        <span className="text-xs text-brand-700">
          rel <b>{dec.reliability_score}/100</b> · opp <b>{dec.opportunity_score}/100</b>
        </span>
      </div>
      <div className="text-sm text-brand-900 mb-2">
        <b>Route reason:</b> {dec.route_reason || '—'}
      </div>
      <div className="text-xs text-brand-700 italic">
        {dec.rationale}
      </div>
    </Panel>
  );
}

function StonePanel({ s }: { s: Record<string, string> | null }) {
  if (!s) {
    return <Panel title="💎 Stone" tone="brand"><EmptyText>Stone not found in inventory.</EmptyText></Panel>;
  }
  return (
    <Panel title="💎 Stone requested" tone="brand">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-xs">
        <Kv k="Stone ID"  v={<span className="font-mono">{s.stock_id}</span>} />
        <Kv k="Status"    v={<StatusPill v={s.status} />} />
        <Kv k="Category"  v={s.category_simple} />
        <Kv k="Shape"     v={s.shape} />
        <Kv k="Carat"     v={`${s.carat} ct`} />
        <Kv k="Colour"    v={s.color} />
        <Kv k="Clarity"   v={s.clarity} />
        <Kv k="Cut"       v={s.cut} />
        <Kv k="Lab"       v={s.lab} />
        <Kv k="Age in stock" v={`${s.age_in_stock_days} d`} />
        <Kv k="Price/ct"  v={dollars(s.ppc)} />
        <Kv k="Total $"   v={dollars(s.p_pcs)} />
      </div>
    </Panel>
  );
}

function CustomerPanel({
  c, kind,
}: {
  c: Record<string, string> | null;
  kind: 'customer' | 'broker';
}) {
  if (!c) {
    return (
      <Panel title={kind === 'customer' ? '👤 Customer' : '🤝 Broker'} tone="brand">
        <EmptyText>{kind === 'customer' ? 'Customer' : 'Broker'} not found.</EmptyText>
      </Panel>
    );
  }
  const churn = parseFloat(c.churn_risk_pct);
  const churnCls = churn >= 0.30 ? 'text-rose-700' : churn >= 0.15 ? 'text-amber-700' : 'text-emerald-700';
  return (
    <Panel title={kind === 'customer' ? '👤 Customer' : '🤝 Broker'} tone="brand">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-xs">
        <Kv k="ID"               v={<span className="font-mono">{c.customer_id}</span>} />
        <Kv k="Name"             v={c.customer_name} />
        <Kv k="Type"             v={c.customer_type} />
        <Kv k="Market"           v={c.market} />
        <Kv k="CLV tier"         v={<TierPill v={c.clv_tier} />} />
        <Kv k="Risk-adj CLV"     v={dollars(c.risk_adjusted_clv)} />
        <Kv k="Annual spend"     v={dollars(c.annual_spend)} />
        <Kv k="Avg order"        v={dollars(c.avg_order_value)} />
        <Kv k="Purchases/yr"     v={c.purchase_frequency} />
        <Kv k="Account lifespan" v={`${c.account_lifespan_years} y`} />
        <Kv k="Gross margin %"   v={`${c.gross_margin_pct}%`} />
        <Kv k="Payment terms"    v={`${c.payment_terms} (${c.payment_terms_days}d)`} />
        <Kv k="Payment score"    v={`${c.payment_score}/100`} />
        <Kv k="Churn risk"       v={<span className={churnCls}>{(churn * 100).toFixed(1)}%</span>} />
        <Kv k="Active"           v={c.active_status} />
        <Kv k="Joined"           v={c.join_date} />
      </div>
    </Panel>
  );
}

function MemoPanel({ m }: { m: Record<string, string> }) {
  return (
    <Panel title="🧾 Memo request" tone="brand">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-xs">
        <Kv k="Memo ID"           v={<span className="font-mono">{m.memo_id}</span>} />
        <Kv k="Requested"         v={shortDate(m.request_date)} />
        <Kv k="Hold days"         v={m.requested_hold_days} />
        <Kv k="Expires"           v={shortDate(m.expiry_date)} />
        <Kv k="Memo state"        v={m.decision} />
        <Kv k="Marketplace lock"  v={m.marketplace_lock_status} />
        <Kv k="Closed outcome"    v={m.closed_outcome || '—'} />
        <Kv k="Thread"            v={m.thread_id || '—'} />
      </div>
    </Panel>
  );
}

function ConflictsPanel({ rows }: { rows: Detail['conflicts'] }) {
  return (
    <Panel title={`⚠ Other memos on this stone (${rows.length})`} tone="amber">
      <div className="text-[11px] overflow-x-auto">
        <table className="w-full">
          <thead className="text-brand-700">
            <tr>
              <th className="text-left py-1 pr-3">Memo</th>
              <th className="text-left py-1 pr-3">Customer</th>
              <th className="text-left py-1 pr-3">State</th>
              <th className="text-left py-1 pr-3">Requested</th>
              <th className="text-left py-1 pr-3">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.memo_id} className="border-t">
                <td className="py-1 pr-3 font-mono">{r.memo_id}</td>
                <td className="py-1 pr-3">{r.customer_id}</td>
                <td className="py-1 pr-3">{r.decision}</td>
                <td className="py-1 pr-3">{shortDate(r.request_date)}</td>
                <td className="py-1 pr-3">{r.closed_outcome || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function PaymentsPanel({ rows }: { rows: Detail['recent_pays'] }) {
  return (
    <Panel title="💰 Recent payment behaviour" tone="brand">
      <div className="text-[11px] overflow-x-auto">
        <table className="w-full">
          <thead className="text-brand-700">
            <tr>
              <th className="text-left py-1 pr-3">Invoice</th>
              <th className="text-left py-1 pr-3">Due</th>
              <th className="text-left py-1 pr-3">Paid</th>
              <th className="text-left py-1 pr-3">Δ days</th>
              <th className="text-left py-1 pr-3">Behaviour</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(p => {
              const days = parseInt(p.days_early_late, 10);
              const cls = days > 7  ? 'text-rose-700'
                        : days > 0  ? 'text-amber-700'
                        :             'text-emerald-700';
              return (
                <tr key={p.invoice_id} className="border-t">
                  <td className="py-1 pr-3 font-mono">{p.invoice_id}</td>
                  <td className="py-1 pr-3">{p.due_date}</td>
                  <td className="py-1 pr-3">{p.payment_date}</td>
                  <td className={`py-1 pr-3 ${cls}`}>{days > 0 ? `+${days}` : days}</td>
                  <td className="py-1 pr-3">{p.payment_behavior_label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ─────────── Tiny helpers ───────────

function Panel({ title, tone, children }: {
  title: string;
  tone: 'brand' | 'amber' | 'emerald' | 'rose';
  children: React.ReactNode;
}) {
  const headCls = tone === 'amber'   ? 'bg-amber-50 text-amber-800'
                : tone === 'emerald' ? 'bg-emerald-50 text-emerald-800'
                : tone === 'rose'    ? 'bg-rose-50 text-rose-800'
                :                       'bg-brand-50 text-brand-800';
  return (
    <div className="card overflow-hidden">
      <div className={`px-3 py-2 font-medium text-sm ${headCls}`}>{title}</div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-widest text-brand-700/60">{k}</div>
      <div className="text-xs text-brand-900 truncate" title={typeof v === 'string' ? v : undefined}>
        {v ?? '—'}
      </div>
    </div>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-brand-700/60">{children}</div>;
}

function dollars(v: string | undefined | null): string {
  if (!v) return '—';
  const n = parseFloat(v);
  if (!isFinite(n)) return v;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function shortDate(v: string | undefined | null): string {
  if (!v) return '—';
  return v.slice(0, 10);
}

function TierPill({ v }: { v: string }) {
  const cls = v === 'Top'  ? 'bg-gold-500/10 text-gold-700'
            : v === 'High' ? 'bg-emerald-50 text-emerald-700'
            : v === 'Mid'  ? 'bg-brand-50 text-brand-700'
            : v === 'Low'  ? 'bg-rose-50 text-rose-700'
            : 'bg-brand-50 text-brand-700';
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${cls}`}>{v || '—'}</span>;
}

function StatusPill({ v }: { v: string }) {
  const cls = v === 'Available' ? 'bg-emerald-50 text-emerald-700'
            : v === 'OnMemo'    ? 'bg-amber-50 text-amber-700'
            : v === 'Hold'      ? 'bg-amber-50 text-amber-700'
            : v === 'Sold'      ? 'bg-brand-100 text-brand-800'
            : 'bg-brand-50 text-brand-700';
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${cls}`}>{v || '—'}</span>;
}
