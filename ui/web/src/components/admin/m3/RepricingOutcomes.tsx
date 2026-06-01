'use client';
import { useMemo, useState } from 'react';
import type { Step } from './types';

type ApplyState = 'idle' | 'applied' | 'failed';

/**
 * Repricing approval board. Same structural idea as MemoOutcomes (3 columns),
 * but here "Approve" pushes the new price into the live Mahant Postgres
 * inventory so the customer-facing storefront sees it. That side effect is
 * gated by a password the desk owner sets in `.env`.
 *
 * Affordances on the right column ("Needs your approval"):
 *   - per-row Approve / Reject
 *   - bulk Approve all selected (Select all checkbox at the top)
 *   - Download CSV of every row (any bucket)
 *   - Password modal before any approval hits the server
 */
export function RepricingOutcomes({
  step,
  onAction,
}: {
  step: Step;
  onAction: (kind: 'applied' | 'rejected', stoneIds: string[]) => void;
}) {
  const buckets = useMemo(() => {
    const auto:    Record<string, string>[] = [];
    const review:  Record<string, string>[] = [];
    const blocked: Record<string, string>[] = []; // FROZEN / MARGIN / QUOTE / UNCHANGED
    for (const r of step.decisions) {
      // Flag column tells us if the stone is locked for a reason
      const flag = (r.flag || '').toUpperCase();
      if (flag === 'FROZEN' || flag === 'MARGIN' || flag === 'QUOTE') {
        blocked.push(r);
        continue;
      }
      if (r.queue === 'auto') auto.push(r);
      else review.push(r);
    }
    return { auto, review, blocked };
  }, [step]);

  // Per-row applied/failed state for visual feedback
  const [states, setStates] = useState<Record<string, ApplyState>>({});
  // Selection set for bulk approve
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Password modal state
  const [modal, setModal] = useState<null | { stoneIds: string[]; total: number }>(null);
  const [password, setPassword] = useState('');
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  function toggleOne(stoneId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(stoneId)) next.delete(stoneId);
      else next.add(stoneId);
      return next;
    });
  }
  function selectAll() {
    setSelected(new Set(buckets.review
      .filter(r => states[r.stock_id] !== 'applied')
      .map(r => r.stock_id)));
  }
  function selectNone() { setSelected(new Set()); }

  function openModal(stoneIds: string[]) {
    if (stoneIds.length === 0) return;
    const total = stoneIds.length;
    setModalError(null);
    setPassword('');
    setModal({ stoneIds, total });
  }

  async function submitModal() {
    if (!modal) return;
    setModalBusy(true); setModalError(null);
    try {
      const stones = modal.stoneIds.map(stoneId => {
        const row = step.decisions.find(d => d.stock_id === stoneId);
        return {
          stoneId,
          proposedTotalPrice: row ? parseFloat(row.proposed_price || '0') : 0,
        };
      });
      const res = await fetch('/api/admin/scintilla/apply-prices', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password, stones }),
      });
      const data = await res.json();
      if (!res.ok) {
        setModalError(data.error ?? `Apply failed (${res.status})`);
        return;
      }
      // Mark approved rows
      const failedSet = new Set<string>(data.failed ?? []);
      setStates(prev => {
        const next = { ...prev };
        for (const sid of modal.stoneIds) {
          next[sid] = failedSet.has(sid) ? 'failed' : 'applied';
        }
        return next;
      });
      // Pop a parent-side toast with what landed
      const okIds = modal.stoneIds.filter(s => !failedSet.has(s));
      onAction('applied', okIds);
      // Done — clear selection + close modal
      setSelected(new Set());
      setModal(null);
    } catch (e: any) {
      setModalError(e?.message ?? 'Apply failed');
    } finally {
      setModalBusy(false);
    }
  }

  function rejectOne(stoneId: string) {
    setStates(prev => ({ ...prev, [stoneId]: 'failed' }));
    setSelected(prev => {
      const next = new Set(prev);
      next.delete(stoneId);
      return next;
    });
    onAction('rejected', [stoneId]);
  }

  function downloadCsv() {
    const allRows = step.decisions;
    if (allRows.length === 0) return;
    const headers = Object.keys(allRows[0]);
    const lines = [headers.join(',')];
    for (const r of allRows) {
      lines.push(headers.map(h => csvCell(r[h])).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `repricing_proposals_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="font-serif text-xl text-brand-900">💎 Repricing proposals</div>
          <div className="text-xs text-brand-700">
            Approve to push the new price into the live inventory.
            Customers see it on the storefront immediately after approval.
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">
            ✅ {buckets.auto.length} auto-applied
          </span>
          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800">
            ⚠ {buckets.review.length} need approval
          </span>
          <span className="px-2 py-0.5 rounded bg-brand-50 text-brand-700">
            🔒 {buckets.blocked.length} blocked
          </span>
          <button
            onClick={downloadCsv}
            className="ml-2 px-2 py-1 rounded border border-brand-200 text-brand-700 hover:bg-brand-50"
          >
            ⬇ Download CSV
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        {/* Column 1 — auto applied */}
        <Column
          title="✅ Auto-applied"
          tone="emerald"
          subtitle="Δ within threshold. Already live on the storefront."
          rows={buckets.auto}
          empty="No prices auto-applied this run."
          renderRow={(r) => <AutoCard row={r} />}
        />

        {/* Column 2 — needs approval */}
        <div className="card overflow-hidden">
          <div className="p-3 bg-amber-50 text-amber-800">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <div className="font-medium">⚠ Needs your approval</div>
                <div className="text-[11px] opacity-80">Δ beyond threshold — sign off before push.</div>
              </div>
              <div className="flex gap-1 items-center text-[10px]">
                {selected.size > 0 && <span>{selected.size} selected · </span>}
                <button onClick={selectAll} className="underline">all</button>
                <span>/</span>
                <button onClick={selectNone} className="underline">none</button>
              </div>
            </div>
            {selected.size > 0 && (
              <button
                onClick={() => openModal([...selected])}
                className="mt-2 w-full px-2 py-1.5 rounded bg-amber-600 text-white text-xs hover:bg-amber-700"
              >
                ▸ Approve {selected.size} selected & push to inventory
              </button>
            )}
            {buckets.review.length > 0 && selected.size === 0 && (
              <button
                onClick={() => openModal(buckets.review.filter(r => states[r.stock_id] !== 'applied').map(r => r.stock_id))}
                className="mt-2 w-full px-2 py-1.5 rounded bg-amber-600 text-white text-xs hover:bg-amber-700"
              >
                ▸ Approve all {buckets.review.length} & push to inventory
              </button>
            )}
          </div>
          <div className="p-3 space-y-2 max-h-[600px] overflow-y-auto">
            {buckets.review.length === 0
              ? <div className="text-xs text-brand-700/60 text-center py-6">Nothing to approve.</div>
              : buckets.review.map(r => (
                  <ApprovalCard
                    key={r.stock_id}
                    row={r}
                    state={states[r.stock_id] ?? 'idle'}
                    selected={selected.has(r.stock_id)}
                    onToggleSelect={() => toggleOne(r.stock_id)}
                    onApprove={() => openModal([r.stock_id])}
                    onReject={() => rejectOne(r.stock_id)}
                  />
                ))
            }
          </div>
        </div>

        {/* Column 3 — blocked */}
        <Column
          title="🔒 Blocked"
          tone="brand"
          subtitle="FROZEN = on memo · MARGIN = breaches floor · QUOTE = open quote."
          rows={buckets.blocked}
          empty="Nothing blocked this run."
          renderRow={(r) => <BlockedCard row={r} />}
        />
      </div>

      {modal && (
        <PasswordModal
          stoneCount={modal.total}
          password={password}
          setPassword={setPassword}
          busy={modalBusy}
          error={modalError}
          onCancel={() => setModal(null)}
          onSubmit={submitModal}
        />
      )}
    </div>
  );
}

// ─── Column shell (mirrors MemoOutcomes' Column) ───
function Column({
  title, tone, subtitle, rows, empty, renderRow,
}: {
  title: string;
  tone: 'emerald' | 'rose' | 'amber' | 'brand';
  subtitle: string;
  rows: Record<string, string>[];
  empty: string;
  renderRow: (r: Record<string, string>) => React.ReactNode;
}) {
  const headerCls = tone === 'emerald' ? 'bg-emerald-50 text-emerald-800'
                  : tone === 'rose'    ? 'bg-rose-50 text-rose-800'
                  : tone === 'amber'   ? 'bg-amber-50 text-amber-800'
                  :                       'bg-brand-50 text-brand-800';
  return (
    <div className="card overflow-hidden">
      <div className={`p-3 ${headerCls}`}>
        <div className="font-medium">{title}</div>
        <div className="text-[11px] opacity-80 mt-0.5">{subtitle}</div>
      </div>
      <div className="p-3 space-y-2 max-h-[600px] overflow-y-auto">
        {rows.length === 0
          ? <div className="text-xs text-brand-700/60 text-center py-6">{empty}</div>
          : rows.map((r, i) => <div key={r.stock_id || i}>{renderRow(r)}</div>)
        }
      </div>
    </div>
  );
}

function AutoCard({ row }: { row: Record<string, string> }) {
  return (
    <div className="border rounded p-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono">{row.stock_id}</span>
        <span className="text-emerald-700">{pctSigned(row.pct_change)}</span>
      </div>
      <div className="text-[11px] text-brand-700 mt-1">
        {dollars(row.old_price)} → <b>{dollars(row.proposed_price)}</b>
      </div>
      <div className="text-[10px] text-brand-700/70 mt-1 truncate" title={row.primary_driver}>
        {row.primary_driver}
      </div>
    </div>
  );
}

function BlockedCard({ row }: { row: Record<string, string> }) {
  const flag = (row.flag || '').toUpperCase();
  const flagCls = flag === 'FROZEN' ? 'bg-brand-100 text-brand-800'
                : flag === 'MARGIN' ? 'bg-rose-100 text-rose-700'
                : flag === 'QUOTE'  ? 'bg-amber-100 text-amber-800'
                :                      'bg-brand-50 text-brand-700';
  return (
    <div className="border rounded p-2 opacity-90">
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono">{row.stock_id}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${flagCls}`}>{flag || '—'}</span>
      </div>
      <div className="text-[10px] text-brand-700/70 mt-1 truncate" title={row.primary_driver}>
        {row.primary_driver}
      </div>
    </div>
  );
}

function ApprovalCard({
  row, state, selected, onToggleSelect, onApprove, onReject,
}: {
  row: Record<string, string>;
  state: ApplyState;
  selected: boolean;
  onToggleSelect: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  if (state === 'applied') {
    return (
      <div className="border rounded p-2 bg-emerald-50/40 opacity-70">
        <div className="flex items-center justify-between text-xs">
          <span className="font-mono">{row.stock_id}</span>
          <span className="text-[10px] text-emerald-700">✅ pushed to inventory</span>
        </div>
      </div>
    );
  }
  if (state === 'failed') {
    return (
      <div className="border rounded p-2 bg-rose-50/40 opacity-70">
        <div className="flex items-center justify-between text-xs">
          <span className="font-mono">{row.stock_id}</span>
          <span className="text-[10px] text-rose-700">❌ rejected (no change pushed)</span>
        </div>
      </div>
    );
  }
  return (
    <div className={`border rounded p-2 ${selected ? 'bg-amber-50/60 border-amber-300' : 'bg-amber-50/30'}`}>
      <div className="flex items-center justify-between text-xs mb-1">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="cursor-pointer"
          />
          <span className="font-mono">{row.stock_id}</span>
        </label>
        <span className={`text-[11px] ${parseFloat(row.pct_change) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
          {pctSigned(row.pct_change)}
        </span>
      </div>
      <div className="text-[11px] text-brand-700 mb-1">
        {dollars(row.old_price)} → <b>{dollars(row.proposed_price)}</b>
      </div>
      <div className="text-[10px] text-brand-700/80 italic mb-2 truncate" title={row.primary_driver}>
        {row.primary_driver}
      </div>
      <div className="flex gap-1">
        <button
          onClick={onApprove}
          className="flex-1 px-2 py-1 rounded bg-emerald-600 text-white text-[11px] hover:bg-emerald-700"
        >
          ✅ Approve & push
        </button>
        <button
          onClick={onReject}
          className="flex-1 px-2 py-1 rounded bg-rose-600 text-white text-[11px] hover:bg-rose-700"
        >
          ❌ Reject
        </button>
      </div>
    </div>
  );
}

function PasswordModal({
  stoneCount, password, setPassword, busy, error, onCancel, onSubmit,
}: {
  stoneCount: number;
  password: string;
  setPassword: (p: string) => void;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="card p-6 bg-white max-w-md w-full mx-4 space-y-3">
        <div className="font-serif text-xl text-brand-900">
          🔐 Confirm price push to live inventory
        </div>
        <p className="text-sm text-brand-700">
          You're about to update <b>{stoneCount}</b> stone{stoneCount === 1 ? '' : 's'} in
          the live Mahant inventory. Customers will see the new price on the storefront immediately.
        </p>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !busy) onSubmit(); }}
          placeholder="Desk owner password"
          className="w-full border rounded px-3 py-2 text-sm"
          autoFocus
        />
        {error && <div className="text-xs text-rose-700">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded border border-brand-200 text-brand-700 text-sm hover:bg-brand-50"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={busy || !password}
            className="px-3 py-1.5 rounded bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-60"
          >
            {busy ? '⏳ Pushing…' : `▸ Push ${stoneCount} to inventory`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── formatters ───
function dollars(v: string): string {
  const n = parseFloat(v);
  if (!isFinite(n)) return v;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function pctSigned(v: string): string {
  const n = parseFloat(v);
  if (!isFinite(n)) return v;
  const sign = n > 0 ? '▲' : n < 0 ? '▼' : '=';
  return `${sign} ${Math.abs(n).toFixed(1)}%`;
}
function csvCell(v: unknown): string {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
