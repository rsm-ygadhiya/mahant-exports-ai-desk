'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fmtUsd, fmtCarat } from '@/lib/format';
import { basisLabel, type PriceSuggestion } from '@/lib/priceSuggestion';

type Row = {
  id: string; stoneId: string; shape: string; carat: number;
  color: string; clarity: string; cut: string | null;
  lab: string | null; certificateNo: string | null;
  currentPpc: number | null;
  addedAt: string;
  suggestion: PriceSuggestion;
};

export function PendingStockReview({ rows, canApprove }: { rows: Row[]; canApprove: boolean }) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function chosenPpc(r: Row): number | null {
    const raw = overrides[r.id];
    if (raw && raw.trim() !== '') {
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    return r.suggestion.suggestedPpc;
  }

  const selectableIds = rows.filter(r => !skipped[r.id]).map(r => r.id);
  const readyCount = useMemo(
    () => selectableIds.filter(id => {
      const r = rows.find(x => x.id === id)!;
      return chosenPpc(r) != null;
    }).length,
    [rows, selectableIds, overrides],
  );

  async function approveSingle(r: Row) {
    if (!canApprove) return;
    const ppc = chosenPpc(r);
    if (ppc == null) { setError('Need a price first.'); return; }
    setBusy(true); setError(null);
    const res = await fetch(`/api/admin/diamonds/${r.id}/approve-price`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pricePerCarat: ppc }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? `Failed (${res.status})`);
      return;
    }
    router.refresh();
  }

  async function approveAllReady() {
    if (!canApprove) return;
    const items = rows
      .filter(r => !skipped[r.id])
      .map(r => ({ id: r.id, ppc: chosenPpc(r) }))
      .filter(x => x.ppc != null)
      .map(x => ({ id: x.id, pricePerCarat: x.ppc as number }));
    if (items.length === 0) { setError('Nothing approvable in the current view.'); return; }
    if (!confirm(`Approve ${items.length} stones and set them Live for buyers?`)) return;

    setBusy(true); setError(null);
    const res = await fetch('/api/admin/pending-stock/bulk-approve', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) { setError(body.error ?? 'Bulk approve failed'); return; }
    alert(`${body.approved} stones approved and set Live.${body.skipped > 0 ? ` ${body.skipped} skipped.` : ''}`);
    router.refresh();
  }

  function applySuggestionTo(r: Row) {
    if (r.suggestion.suggestedPpc != null) {
      setOverrides(prev => ({ ...prev, [r.id]: String(r.suggestion.suggestedPpc) }));
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Stat label="Pending" value={rows.length} />
        <Stat label="Ready to approve" value={readyCount} tone="green" />
        <Stat label="No comparables" value={rows.filter(r => r.suggestion.basis === 'no_match').length} tone="rose" />
        <Stat label="Skipped" value={Object.values(skipped).filter(Boolean).length} tone="brand" />
      </div>

      {canApprove && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-brand-700">
            Tick a row → enter or accept the price → click <b>Approve</b>. Or hit
            <b className="ml-1">Approve all ready</b> to publish every priced row in one go (passcode-free, audit-logged).
          </p>
          <button onClick={approveAllReady} disabled={busy || readyCount === 0} className="btn-primary">
            ✓ Approve all ready ({readyCount}) → set Live
          </button>
        </div>
      )}

      {error && <div className="text-rose-700 text-sm bg-rose-50 p-2 rounded">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-brand-50 text-brand-700 text-left">
            <tr>
              <th className="px-3 py-2">Stone</th>
              <th className="px-3 py-2">Spec</th>
              <th className="px-3 py-2 text-right">Current $/ct</th>
              <th className="px-3 py-2 text-right">Suggested $/ct</th>
              <th className="px-3 py-2">Basis</th>
              <th className="px-3 py-2 text-right">Override $/ct</th>
              <th className="px-3 py-2 text-right">Total at chosen</th>
              {canApprove && <th className="px-3 py-2 text-right">Decide</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const chosen = chosenPpc(r);
              const isSkipped = !!skipped[r.id];
              return (
                <tr key={r.id} className={`border-t border-brand-100 align-top ${isSkipped ? 'opacity-40' : ''}`}>
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`/admin/diamonds/${r.id}`} className="text-gold-700 hover:underline">{r.stoneId}</Link>
                    {r.suggestion.basis === 'no_match' && (
                      <div className="mt-0.5"><Pill tone="rose" title="No comparable stones found">📭 no match</Pill></div>
                    )}
                    {r.suggestion.basis !== 'no_match' && r.suggestion.basis !== 'exact' && (
                      <div className="mt-0.5"><Pill tone="amber" title={basisLabel(r.suggestion.basis)}>~{r.suggestion.basis.replace('_', ' ')}</Pill></div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.shape} {fmtCarat(r.carat)} {r.color}/{r.clarity}
                    {r.cut && <span className="block text-brand-700/70">cut: {r.cut}</span>}
                    {r.lab && <span className="block text-brand-700/70">{r.lab} {r.certificateNo}</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    {r.currentPpc != null ? fmtUsd(r.currentPpc) : <span className="text-brand-700/40">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.suggestion.suggestedPpc != null ? (
                      <>
                        <div className="font-medium">{fmtUsd(r.suggestion.suggestedPpc)}</div>
                        <button onClick={() => applySuggestionTo(r)} className="text-xs text-gold-600 hover:underline">Use this</button>
                      </>
                    ) : <span className="text-brand-700/40">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div title={basisLabel(r.suggestion.basis)}>
                      {basisLabel(r.suggestion.basis)}
                    </div>
                    {r.suggestion.stats && (
                      <div className="text-brand-700/70 mt-0.5">
                        {r.suggestion.comparablesUsed} comparables ·
                        ${r.suggestion.stats.min}–${r.suggestion.stats.max} (avg ${r.suggestion.stats.mean})
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input type="number" step="1" min="1"
                           value={overrides[r.id] ?? ''}
                           placeholder={r.suggestion.suggestedPpc ? '(use suggestion)' : 'enter price'}
                           onChange={e => setOverrides(prev => ({ ...prev, [r.id]: e.target.value }))}
                           className="input max-w-[110px] text-right" />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {chosen != null ? <b>{fmtUsd(chosen * r.carat)}</b> : <span className="text-brand-700/40">—</span>}
                  </td>
                  {canApprove && (
                    <td className="px-3 py-2 text-right whitespace-nowrap text-xs">
                      {isSkipped ? (
                        <button onClick={() => setSkipped(prev => ({ ...prev, [r.id]: false }))}
                                className="text-brand-700 hover:underline">Unskip</button>
                      ) : (
                        <div className="flex flex-col gap-1 items-end">
                          <button onClick={() => approveSingle(r)} disabled={busy || chosen == null}
                                  className="text-emerald-700 hover:underline disabled:opacity-30">
                            ✓ Approve & Set Live
                          </button>
                          <button onClick={() => setSkipped(prev => ({ ...prev, [r.id]: true }))}
                                  className="text-brand-700 hover:underline">
                            Skip
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={canApprove ? 8 : 7} className="text-center py-12 text-brand-700 text-sm">
                No pending stock — every uploaded stone is already live or sold.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'rose' | 'brand' }) {
  const cls = tone === 'green' ? 'text-emerald-700'
            : tone === 'rose'  ? 'text-rose-700'
            : tone === 'brand' ? 'text-brand-700'
            : 'text-brand-900';
  return (
    <div className="card p-3">
      <div className="text-xs uppercase tracking-widest text-brand-700">{label}</div>
      <div className={`text-2xl font-serif mt-0.5 ${cls}`}>{value}</div>
    </div>
  );
}

function Pill({ tone, title, children }: { tone: 'green' | 'amber' | 'rose' | 'brand'; title?: string; children: React.ReactNode }) {
  const cls = {
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    rose:  'bg-rose-50 text-rose-700',
    brand: 'bg-brand-50 text-brand-700',
  }[tone];
  return <span title={title} className={`inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium ${cls}`}>{children}</span>;
}
