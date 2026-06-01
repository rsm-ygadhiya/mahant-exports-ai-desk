'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Initial = {
  enabled: boolean;
  frequency: 'DAILY' | 'WEEKLY' | 'CUSTOM';
  timeOfDay: string;
  dayOfWeek: number;
  mode: 'ai' | 'heuristic';
  rapDiscountPct: number;
  skipIfRecentHrs: number;
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ScheduleForm({
  initial, canEdit, canRun,
}: {
  initial: Initial; canEdit: boolean; canRun: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [frequency, setFrequency] = useState<Initial['frequency']>(initial.frequency);
  const [timeOfDay, setTimeOfDay] = useState(initial.timeOfDay);
  const [dayOfWeek, setDayOfWeek] = useState(initial.dayOfWeek);
  const [mode, setMode] = useState<Initial['mode']>(initial.mode);
  const [discount, setDiscount] = useState(String(initial.rapDiscountPct));
  const [skipHrs, setSkipHrs] = useState(String(initial.skipIfRecentHrs));

  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<string | null>(null);

  const dirty =
    enabled !== initial.enabled ||
    frequency !== initial.frequency ||
    timeOfDay !== initial.timeOfDay ||
    dayOfWeek !== initial.dayOfWeek ||
    mode !== initial.mode ||
    Number(discount) !== initial.rapDiscountPct ||
    Number(skipHrs) !== initial.skipIfRecentHrs;

  async function save() {
    setBusy(true); setError(null); setSavedAt(null);
    const res = await fetch('/api/admin/pricing/schedule', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled, frequency, timeOfDay, dayOfWeek, mode,
        rapDiscountPct: Number(discount),
        skipIfRecentHrs: Number(skipHrs),
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error ?? `Failed (${res.status})`); return; }
    setSavedAt(new Date().toLocaleTimeString());
    router.refresh();
  }

  async function runNow() {
    if (!confirm('Run the scheduled pricing engine right now? Creates a DRAFT run you can then review.')) return;
    setBusy(true); setError(null); setRunResult(null);
    const res = await fetch('/api/admin/pricing/schedule/run-now', { method: 'POST' });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error ?? `Failed (${res.status})`); return; }
    setRunResult(data.runId);
    router.refresh();
  }

  return (
    <div className="card p-5 space-y-5 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-xl">Schedule</h2>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={enabled} disabled={!canEdit}
                 onChange={e => setEnabled(e.target.checked)} className="h-4 w-4" />
          <span className="text-sm">{enabled ? 'Enabled' : 'Disabled'}</span>
        </label>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-xs uppercase tracking-widest text-brand-700">Frequency</span>
          <select className="input mt-1" value={frequency} disabled={!canEdit}
                  onChange={e => setFrequency(e.target.value as any)}>
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
            <option value="CUSTOM" disabled>Custom cron (coming soon)</option>
          </select>
        </label>

        <label className="block">
          <span className="text-xs uppercase tracking-widest text-brand-700">Time of day (server local)</span>
          <input type="time" value={timeOfDay} disabled={!canEdit}
                 onChange={e => setTimeOfDay(e.target.value)} className="input mt-1" />
        </label>

        {frequency === 'WEEKLY' && (
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-brand-700">Day of week</span>
            <select className="input mt-1" value={dayOfWeek} disabled={!canEdit}
                    onChange={e => setDayOfWeek(Number(e.target.value))}>
              {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-xs uppercase tracking-widest text-brand-700">Engine</span>
          <select className="input mt-1" value={mode} disabled={!canEdit}
                  onChange={e => setMode(e.target.value as any)}>
            <option value="heuristic">⚡ Heuristic (instant, free)</option>
            <option value="ai">✨ AI (GPT-4o, needs API key)</option>
          </select>
        </label>

        <label className="block">
          <span className="text-xs uppercase tracking-widest text-brand-700">Discount off Rap (%)</span>
          <input type="number" min="0" max="99" step="0.5" value={discount} disabled={!canEdit}
                 onChange={e => setDiscount(e.target.value)} className="input mt-1" />
        </label>

        <label className="block">
          <span className="text-xs uppercase tracking-widest text-brand-700">Skip if recent DRAFT (hours)</span>
          <input type="number" min="0" max="168" step="1" value={skipHrs} disabled={!canEdit}
                 onChange={e => setSkipHrs(e.target.value)} className="input mt-1" />
        </label>
      </div>

      {error && <div className="text-rose-700 text-sm bg-rose-50 p-2 rounded">{error}</div>}

      <div className="flex items-center justify-between border-t border-brand-100 pt-3 gap-3 flex-wrap">
        <div className="text-xs text-brand-700">
          {savedAt ? <span className="text-emerald-700">✓ Saved at {savedAt}</span>
                   : dirty ? 'Unsaved changes' : 'No changes'}
          {runResult && (
            <span className="ml-3">
              Run created — <a className="text-gold-600 underline" href={`/admin/pricing/runs/${runResult}`}>open run</a>
            </span>
          )}
        </div>
        <div className="flex gap-3">
          {canRun && (
            <button onClick={runNow} disabled={busy} className="btn-outline">
              {busy ? 'Running…' : '⚡ Run now'}
            </button>
          )}
          {canEdit && (
            <button onClick={save} disabled={busy || !dirty} className="btn-primary">
              {busy ? 'Saving…' : 'Save schedule'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
