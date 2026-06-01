'use client';
import { useRef, useState } from 'react';
import { DayBanner } from '@/components/admin/m3/DayBanner';
import { SettingsPopover } from '@/components/admin/m3/SettingsPopover';
import { StepSummary } from '@/components/admin/m3/StepSummary';
import { MemoOutcomes } from '@/components/admin/m3/MemoOutcomes';
import { RepricingOutcomes } from '@/components/admin/m3/RepricingOutcomes';
import { ProgressTimeline, type StepStatus } from '@/components/admin/m3/ProgressTimeline';
import type { RunBody, Step, StepName } from '@/components/admin/m3/types';

const ALL_STEPS: StepName[] = [
  'triage-inventory', 'propose-repricing', 'rank-customer-clv', 'decide-memo',
];

const INITIAL_STATUSES: Record<StepName, StepStatus> = {
  'triage-inventory':  'pending',
  'propose-repricing': 'pending',
  'rank-customer-clv': 'pending',
  'decide-memo':       'pending',
};

/**
 * ✦ Scintilla — streaming version.
 *
 * Subscribes to the NDJSON stream from /api/admin/scintilla/run-stream
 * and renders each step's card as the server signals it finished. The
 * progress timeline at the top shows pending → running → done in real
 * time, so the user actually watches the routine work, not just
 * "everything appeared after 4 seconds."
 */
export default function ScintillaPage() {
  const [body, setBody] = useState<RunBody>({
    thresholdPct: 7,
    oppCeiling: 70,
    autoTiers: ['Top', 'High'],
  });
  const [busy, setBusy] = useState(false);

  // Streaming run state
  const [runId, setRunId] = useState<string>('');
  const [statuses, setStatuses] = useState<Record<StepName, StepStatus>>(INITIAL_STATUSES);
  const [steps, setSteps] = useState<Record<StepName, Step | undefined>>({} as any);
  const [durations, setDurations] = useState<Record<StepName, number | undefined>>({} as any);
  const [active, setActive] = useState<StepName | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);

  const [resetBusy, setResetBusy] = useState(false);
  const stepStartTimes = useRef<Partial<Record<StepName, number>>>({});

  function toast(text: string) {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, text }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }

  function resetRunState() {
    setRunId('');
    setStatuses(INITIAL_STATUSES);
    setSteps({} as any);
    setDurations({} as any);
    setActive(null);
    setError(null);
    stepStartTimes.current = {};
  }

  async function run() {
    setBusy(true);
    resetRunState();
    try {
      const res = await fetch('/api/admin/scintilla/run-stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Run failed (${res.status})`);
        return;
      }
      if (!res.body) {
        setError('No response body — streaming unavailable on this client.');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try { handleEvent(JSON.parse(line)); } catch { /* skip malformed */ }
        }
      }
      if (buf.trim()) {
        try { handleEvent(JSON.parse(buf)); } catch { /* skip */ }
      }
    } catch (e: any) {
      setError(e?.message ?? 'Run failed');
    } finally {
      setBusy(false);
      setActive(null);
    }
  }

  function handleEvent(ev: any) {
    switch (ev.event) {
      case 'run-start':
        setRunId(ev.run_id ?? '');
        break;
      case 'step-start':
        stepStartTimes.current[ev.name as StepName] = Date.now();
        setActive(ev.name as StepName);
        setStatuses(prev => ({ ...prev, [ev.name as StepName]: 'running' }));
        break;
      case 'step-end': {
        const name = ev.name as StepName;
        const start = stepStartTimes.current[name];
        const dur = start ? Date.now() - start : undefined;
        setStatuses(prev => ({ ...prev, [name]: ev.envelope ? 'done' : 'error' }));
        setDurations(prev => ({ ...prev, [name]: dur }));
        if (ev.envelope) {
          setSteps(prev => ({
            ...prev,
            [name]: {
              name,
              envelope: ev.envelope,
              decisions: ev.decisions ?? [],
              artifact: ev.artifact ?? '',
            },
          }));
          toast(`✓ ${name} done${dur ? ` (${(dur/1000).toFixed(1)}s)` : ''}`);
        }
        if (active === name) setActive(null);
        break;
      }
      case 'step-error':
        setStatuses(prev => ({ ...prev, [ev.name as StepName]: 'error' }));
        setError(`Step ${ev.name} failed: ${ev.message ?? 'unknown'}`);
        break;
      case 'run-error':
        setError(ev.message ?? 'Run failed');
        break;
      case 'run-end':
        // Final wrap — already done
        break;
    }
  }

  async function resetData() {
    if (!window.confirm('Reset simulated data back to baseline?')) return;
    setResetBusy(true);
    try {
      const res = await fetch('/api/admin/scintilla/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) {
        toast(`🔄 ${data.action}`);
        resetRunState();
      } else {
        toast(`❌ ${data.error ?? 'reset failed'}`);
      }
    } catch (e: any) {
      toast(`❌ ${e?.message ?? 'reset failed'}`);
    } finally {
      setResetBusy(false);
    }
  }

  const hasAnyResult = Object.values(steps).some(Boolean);
  const memoStep      = steps['decide-memo'];
  const repricingStep = steps['propose-repricing'];
  const triageStep    = steps['triage-inventory'];
  const clvStep       = steps['rank-customer-clv'];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl">
            <span className="text-gold-600">✦</span> Scintilla
          </h1>
          <p className="text-sm text-brand-700 mt-1">
            Pramukh Gems' daily sales-desk autopilot. One click runs the four-step routine;
            clear cases auto-decide, ambiguous ones come to you.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SettingsPopover body={body} setBody={setBody} />
          <button
            onClick={resetData}
            disabled={resetBusy || busy}
            className="text-xs px-3 py-1.5 rounded border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            title="Restore data/raw/ from the frozen baseline so you can re-run a clean demo."
          >
            {resetBusy ? '⏳ Resetting…' : '🔄 Reset data'}
          </button>
        </div>
      </div>

      <DayBanner body={body} setBody={setBody} />

      {/* The big button */}
      <div className="card p-6 bg-gradient-to-br from-brand-700 to-brand-900 text-white flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="font-serif text-xl">Ready when you are.</div>
          <p className="text-sm text-brand-100 mt-1 max-w-xl">
            Runs <b>triage → repricing → CLV → memo</b> end-to-end. You'll see each step light
            up as it finishes — the whole routine takes a few seconds.
          </p>
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="px-6 py-3 rounded bg-gold-500 hover:bg-gold-400 text-brand-900 font-medium disabled:opacity-60 shadow-lg"
        >
          {busy ? '⏳ Running…' : "✦ Run today's routine"}
        </button>
      </div>

      {/* Progress timeline — visible whenever a run is in flight or just finished */}
      {(busy || hasAnyResult) && (
        <ProgressTimeline
          statuses={statuses}
          durations={durations}
          active={active}
        />
      )}

      {/* Error */}
      {error && (
        <div className="card p-4 bg-rose-50/40 border-rose-300">
          <div className="text-xs uppercase tracking-widest text-rose-700 mb-1">Error</div>
          <div className="text-sm text-rose-800 whitespace-pre-wrap">{error}</div>
        </div>
      )}

      {/* Run banner */}
      {runId && hasAnyResult && (
        <div className="card p-2 px-3 text-xs flex items-center justify-between gap-2 bg-brand-50/40">
          <span className="text-brand-700">
            <b>Run:</b> <span className="font-mono">{runId}</span>
            {' · '}
            <b>Threshold A:</b> ±{(body.thresholdPct ?? 7).toFixed(1)}%
            {' · '}
            <b>Threshold B:</b> opp ≤ {body.oppCeiling ?? 70}
          </span>
        </div>
      )}

      {/* Quiet upstream summaries (triage + CLV) — appear as they finish */}
      {(triageStep || clvStep) && (
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-widest text-brand-700">
            Upstream automations (auto, no human needed)
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {triageStep && <StepSummary key="triage" step={triageStep} />}
            {clvStep    && <StepSummary key="clv"    step={clvStep} />}
          </div>
        </div>
      )}

      {/* Repricing board */}
      {repricingStep && (
        <RepricingOutcomes
          step={repricingStep}
          onAction={(kind, ids) => {
            if (ids.length === 0) return;
            toast(kind === 'applied'
              ? `✅ Pushed ${ids.length} price update${ids.length === 1 ? '' : 's'} to live inventory`
              : `❌ Rejected ${ids.length} repricing proposal${ids.length === 1 ? '' : 's'}`
            );
          }}
        />
      )}

      {/* Memo board */}
      {memoStep && (
        <MemoOutcomes
          step={memoStep}
          onAction={(verdict, memo) => {
            toast(
              verdict === 'approved'
                ? `✅ ${memo.memo_id} approved · 📨 memo draft queued for ${memo.customer_id}`
                : `❌ ${memo.memo_id} rejected · 📨 polite decline queued for ${memo.customer_id}`
            );
          }}
        />
      )}

      {/* Onboarding card if nothing has run yet */}
      {!hasAnyResult && !busy && !error && (
        <div className="card p-6 text-sm text-brand-700">
          <div className="font-medium mb-2">First time here?</div>
          <ol className="list-decimal ml-5 space-y-1 text-xs">
            <li>Hit <b>✦ Run today's routine</b>. A live progress strip lights up — each of the
              four steps goes pending → running → done as the Python actually executes on the
              server.</li>
            <li>Cards materialize below the strip in the order they finish. Triage and CLV are
              quiet summary cards; repricing and memo open into full approval boards.</li>
            <li><b>💎 Repricing</b>: per-row Approve / Reject + Approve all selected + Download
              CSV. Approving prompts for a password before pushing to the live storefront.</li>
            <li><b>📝 Memo</b>: three columns — auto-approved, auto-rejected (incl. "stone already
              held by another customer"), and ⚠ Needs your sign-off with Approve / Reject buttons.</li>
            <li><b>🔄 Reset data</b> rolls every CSV back to baseline for a clean demo re-run.</li>
          </ol>
        </div>
      )}

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 space-y-2 z-50">
        {toasts.map(t => (
          <div key={t.id}
               className="card px-4 py-2 text-sm bg-brand-900 text-white shadow-lg max-w-md">
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
