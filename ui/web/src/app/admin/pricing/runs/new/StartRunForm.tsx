'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function StartRunForm({ available }: { available: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'heuristic' | 'ai'>('heuristic');
  const [notes, setNotes] = useState('');
  const [discPct, setDiscPct] = useState('95');  // discount off Rap, percent
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true); setError(null);
    const d = Number(discPct);
    if (!Number.isFinite(d) || d < 0 || d >= 100) {
      setError('Discount must be between 0 and 99 (exclusive).');
      setBusy(false); return;
    }
    const res = await fetch('/api/admin/pricing/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode,
        notes: notes || undefined,
        rapMultiplier: (100 - d) / 100,    // 95% discount → 0.05 multiplier
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error ?? `Failed (${res.status})`); return; }
    router.push(`/admin/pricing/runs/${data.runId}`);
  }

  return (
    <div className="card p-6 space-y-4">
      <div>
        <div className="text-xs uppercase tracking-widest text-brand-700 mb-2">Engine</div>
        <div className="grid md:grid-cols-2 gap-3">
          <button type="button" onClick={() => setMode('heuristic')}
                  className={`card p-4 text-left ${mode === 'heuristic' ? 'border-2 border-gold-500' : ''}`}>
            <div className="text-sm font-medium">⚡ Heuristic</div>
            <div className="text-xs text-brand-700 mt-1">
              Rap × 85% × age curve × demand multiplier, rounded to $5, with a 25% margin floor. Instant. Runs on every stone.
            </div>
          </button>
          <button type="button" onClick={() => setMode('ai')}
                  className={`card p-4 text-left ${mode === 'ai' ? 'border-2 border-gold-500' : ''}`}>
            <div className="text-sm font-medium">✨ AI (GPT-4o)</div>
            <div className="text-xs text-brand-700 mt-1">
              Same factors, but with category-aware judgment and natural-language reasoning per stone. Up to 200 stones per call; rest fall back to heuristic. Requires <span className="font-mono">OPENAI_API_KEY</span>.
            </div>
          </button>
        </div>
      </div>

      <div className="space-y-1">
        <label className="block">
          <span className="text-xs uppercase tracking-widest text-brand-700">
            Discount off Rap (lab-grown is typically 95%+ off natural Rap)
          </span>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <input value={discPct} onChange={e => setDiscPct(e.target.value)}
                   type="number" step="1" min="0" max="99"
                   className="input max-w-[120px]" />
            <span className="text-sm text-brand-700">% off Rap</span>
            <div className="flex gap-1 ml-2">
              {[97, 95, 90, 80, 15].map(p => (
                <button key={p} type="button" onClick={() => setDiscPct(String(p))}
                        className={`text-xs px-2 py-1 rounded border ${discPct === String(p) ? 'border-gold-500 bg-gold-500/10' : 'border-brand-100 hover:bg-brand-50'}`}>
                  {p}%
                </button>
              ))}
            </div>
          </div>
        </label>
        <p className="text-xs text-brand-700/70 leading-snug">
          Real-world workflow: Rap → discount based on unit economics + Nivoda comparable → final $/ct.
          {' '}Most lab-grown wholesale lands at <b>95–97% off natural Rap</b>.
          Set <b>15%</b> only if your uploaded sheets are <i>lab-grown index</i> (not natural Rap).
          {' '}Basis ≈ <span className="font-mono">${(100 - (Number(discPct) || 0))}/$100 of Rap</span>.
        </p>
      </div>

      <label className="block">
        <span className="text-xs uppercase tracking-widest text-brand-700">Run notes (optional)</span>
        <input value={notes} onChange={e => setNotes(e.target.value)}
               placeholder="e.g. Weekly run, post Diwali demand spike"
               className="input mt-1" />
      </label>

      {error && <div className="text-rose-700 text-sm bg-rose-50 p-2 rounded">{error}</div>}

      <div className="flex justify-between items-center">
        <p className="text-xs text-brand-700">
          Will generate {available.toLocaleString()} proposal{available === 1 ? '' : 's'}.
          {' '}{mode === 'ai' ? 'Takes ~10–30 seconds.' : 'Should complete in seconds.'}
        </p>
        <button onClick={start} disabled={busy || available === 0} className="btn-primary">
          {busy ? 'Generating proposals…' : 'Generate proposals →'}
        </button>
      </div>
    </div>
  );
}
