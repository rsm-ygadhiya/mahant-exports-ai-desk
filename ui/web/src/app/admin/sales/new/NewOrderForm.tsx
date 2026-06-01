'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtCarat, fmtUsd } from '@/lib/format';

type Customer = {
  id: string; uniqueCode: string | null;
  companyName: string; contactPerson: string; mobile: string;
};

type Stone = {
  id: string; stoneId: string; shape: string; carat: number;
  color: string; clarity: string;
  lab: string | null; certificateNo: string | null;
  status: 'AVAILABLE' | 'HOLD';
  pricePerCarat: number; totalPrice: number;
};

export function NewOrderForm({
  customers, defaultCustomerId, stones,
}: { customers: Customer[]; defaultCustomerId: string | null; stones: Stone[] }) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? '');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  /// Per-stone price overrides — key by stone id, value as string for raw input.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmImmediately, setConfirmImmediately] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return stones;
    return stones.filter(s =>
      s.stoneId.toLowerCase().includes(q) ||
      (s.certificateNo ?? '').toLowerCase().includes(q) ||
      `${s.shape} ${s.color} ${s.clarity}`.toLowerCase().includes(q),
    );
  }, [stones, filter]);

  const chosen = stones.filter(s => selected[s.id]);
  const total = chosen.reduce((sum, s) => {
    const ppcOverride = overrides[s.id];
    const ppc = ppcOverride && ppcOverride !== '' ? Number(ppcOverride) : s.pricePerCarat;
    return sum + (Number.isFinite(ppc) ? ppc * s.carat : s.totalPrice);
  }, 0);

  async function submit() {
    setError(null);
    if (!customerId) { setError('Pick a customer first.'); return; }
    if (chosen.length === 0) { setError('Select at least one stone.'); return; }

    const prices: Record<string, { pricePerCarat: number }> = {};
    for (const s of chosen) {
      const raw = overrides[s.id];
      if (raw && raw !== '') prices[s.id] = { pricePerCarat: Number(raw) };
    }

    setBusy(true);
    const res = await fetch('/api/admin/orders', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId,
        diamondIds: chosen.map(s => s.id),
        prices,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        notes: notes || undefined,
        confirmImmediately,
      }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) { setError(body.error ?? `Failed (${res.status})`); return; }
    router.push(`/admin/sales/${body.orderId}`);
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 grid md:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-xs uppercase tracking-widest text-brand-700">Customer *</span>
          <select className="input mt-1" value={customerId} onChange={e => setCustomerId(e.target.value)}>
            <option value="">— Pick a customer —</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>
                {c.companyName} — {c.contactPerson} {c.uniqueCode ? `· ${c.uniqueCode}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-widest text-brand-700">Payment due date (optional)</span>
          <input type="date" className="input mt-1" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-widest text-brand-700">Notes (internal)</span>
          <input className="input mt-1" value={notes} onChange={e => setNotes(e.target.value)} />
        </label>
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-serif text-lg">Pick stones</h2>
          <div className="flex items-center gap-2 text-sm">
            <input value={filter} onChange={e => setFilter(e.target.value)}
                   placeholder="Search stone ID / cert / shape…"
                   className="input max-w-[260px]" />
            <span className="text-xs text-brand-700">{chosen.length} selected · {visible.length} visible / {stones.length} total</span>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[480px]">
          <table className="w-full text-sm">
            <thead className="bg-brand-50 text-brand-700 text-left sticky top-0">
              <tr>
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2">Stone</th>
                <th className="px-3 py-2">Spec</th>
                <th className="px-3 py-2 text-right">Current $/ct</th>
                <th className="px-3 py-2 text-right">Override $/ct</th>
                <th className="px-3 py-2 text-right">Line total</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, 300).map(s => {
                const on = !!selected[s.id];
                const ppcRaw = overrides[s.id];
                const ppc = ppcRaw && ppcRaw !== '' ? Number(ppcRaw) : s.pricePerCarat;
                const line = Number.isFinite(ppc) ? ppc * s.carat : s.totalPrice;
                return (
                  <tr key={s.id} className={`border-t border-brand-100 ${on ? 'bg-gold-500/5' : ''}`}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={on}
                             onChange={e => setSelected(prev => ({ ...prev, [s.id]: e.target.checked }))} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{s.stoneId}</td>
                    <td className="px-3 py-2 text-xs">{s.shape} {fmtCarat(s.carat)} {s.color}/{s.clarity}{s.lab && <> · {s.lab}</>}</td>
                    <td className="px-3 py-2 text-right">{fmtUsd(s.pricePerCarat)}</td>
                    <td className="px-3 py-2 text-right">
                      <input type="number" step="1" min="1"
                             disabled={!on}
                             value={ppcRaw ?? ''}
                             placeholder="(use current)"
                             onChange={e => setOverrides(prev => ({ ...prev, [s.id]: e.target.value }))}
                             className="input max-w-[110px] text-right text-xs" />
                    </td>
                    <td className="px-3 py-2 text-right">{fmtUsd(line)}</td>
                    <td className="px-3 py-2 text-xs">{s.status}</td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={7} className="text-center py-8 text-brand-700">No stones match the search.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-widest text-brand-700">Order total</div>
          <div className="font-serif text-3xl">{fmtUsd(total)}</div>
          <p className="text-xs text-brand-700 mt-1">{chosen.length} stone{chosen.length === 1 ? '' : 's'}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={confirmImmediately}
                 onChange={e => setConfirmImmediately(e.target.checked)} />
          Confirm immediately (flip stones to <b>Sold</b>)
        </label>
        <div className="flex gap-2">
          <button onClick={submit} disabled={busy || !customerId || chosen.length === 0} className="btn-primary">
            {busy ? 'Creating…' : confirmImmediately ? 'Create & confirm →' : 'Save draft'}
          </button>
        </div>
      </div>

      {error && <div className="card p-3 bg-rose-50 border-rose-200 text-rose-800 text-sm">{error}</div>}
    </div>
  );
}
