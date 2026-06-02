'use client';
import { useState } from 'react';

type MetricResult = {
  metric: string;
  score: number;
  threshold: number;
  passed: boolean;
  reason: string;
};
type CaseResult = {
  name: string;
  description: string;
  passed: boolean;
  duration_ms: number;
  error: string | null;
  metrics: MetricResult[];
};
type SuiteResult = {
  suite: string;
  description: string;
  total: number;
  passed: number;
  failed: number;
  cases: CaseResult[];
  deepeval_available: boolean;
};

const SUITES: Array<{ key: string; title: string; icon: string; blurb: string }> = [
  {
    key: 'triage', icon: '⏳', title: 'Inventory Aging Triage',
    blurb: 'Tag schema · HOLD/WATCH/DISCOUNT/CLEAR validity · reason quality.',
  },
  {
    key: 'repricing', icon: '💎', title: 'Weekly Repricing',
    blurb: 'Queue routing · % change sanity · driver text presence.',
  },
  {
    key: 'clv', icon: '👑', title: 'Customer CLV Ranking',
    blurb: 'Quartile balance · tier ordering · entity uniqueness.',
  },
  {
    key: 'memo', icon: '📝', title: 'Memo Approval',
    blurb: 'FIFO uniqueness · queue↔decision consistency · rationale quality (+ optional LLM judge).',
  },
  {
    key: 'opportunities', icon: '🌐', title: 'Opportunity Finder',
    blurb: 'Schema · vocab · no placeholder URLs/emails · URL/email shape · fit-summary groundedness (+ optional LLM judge).',
  },
];

export default function EvalsPage() {
  const [results, setResults] = useState<Record<string, SuiteResult>>({});
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function runSuite(key: string) {
    setRunning(p => ({ ...p, [key]: true }));
    setErrors(p => ({ ...p, [key]: '' }));
    try {
      const r = await fetch('/api/admin/evals/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ suite: key }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setResults(p => ({ ...p, [key]: data }));
    } catch (e: any) {
      setErrors(p => ({ ...p, [key]: e?.message ?? 'run failed' }));
    } finally {
      setRunning(p => ({ ...p, [key]: false }));
    }
  }

  async function runAll() {
    for (const s of SUITES) {
      // Sequential — keeps the UI changes legible and avoids hammering the
      // Python interpreter with parallel uv-run spawns.
      // eslint-disable-next-line no-await-in-loop
      await runSuite(s.key);
    }
  }

  const anyResult = Object.values(results)[0];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl">🧪 Reliability Evals</h1>
          <p className="text-sm text-brand-700 mt-1 max-w-2xl">
            DeepEval-style test suites for every Scintilla skill. Each suite reads the
            latest CSV the skill produced and checks the invariants the rest of the
            pipeline depends on. Click <b>Run</b> on any suite, or run all four.
          </p>
        </div>
        <button
          onClick={runAll}
          disabled={Object.values(running).some(Boolean)}
          className="shrink-0 px-4 py-2 rounded bg-brand-900 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          ▶ Run all suites
        </button>
      </div>

      {anyResult && !anyResult.deepeval_available && (
        <div className="card p-3 text-xs text-brand-700 bg-amber-50/60 border border-amber-200">
          <b>Heads-up:</b> DeepEval&apos;s LLM-judge metrics need <span className="font-mono">deepeval</span> installed
          and <span className="font-mono">OPENAI_API_KEY</span> set. Without it, evals still run with deterministic metrics
          (schema, value ranges, FIFO uniqueness, etc.) — just no graded text quality.
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {SUITES.map(s => {
          const res = results[s.key];
          const isRunning = !!running[s.key];
          const err = errors[s.key];
          return (
            <div key={s.key} className="card p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{s.icon}</span>
                    <span className="font-serif text-lg">{s.title}</span>
                  </div>
                  <p className="text-xs text-brand-700 mt-1">{s.blurb}</p>
                </div>
                <button
                  onClick={() => runSuite(s.key)}
                  disabled={isRunning}
                  className="px-3 py-1.5 rounded bg-brand-900 text-white text-xs font-medium hover:bg-brand-700 disabled:opacity-50 whitespace-nowrap"
                >
                  {isRunning ? 'Running…' : res ? 'Re-run' : 'Run'}
                </button>
              </div>

              {err && (
                <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">
                  {err}
                </div>
              )}

              {res && <SuiteResultsBlock res={res} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SuiteResultsBlock({ res }: { res: SuiteResult }) {
  const passRate = res.total > 0 ? res.passed / res.total : 0;
  const barColor =
    res.failed === 0 ? 'bg-emerald-500' : passRate >= 0.7 ? 'bg-amber-500' : 'bg-rose-500';

  return (
    <div className="space-y-2">
      {/* Summary bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full bg-brand-100 overflow-hidden">
          <div className={`h-full ${barColor} transition-all`} style={{ width: `${passRate * 100}%` }} />
        </div>
        <div className="text-xs font-mono text-brand-900">
          <span className="text-emerald-700">{res.passed}</span>
          <span className="text-brand-400"> / </span>
          <span>{res.total}</span>
          {res.failed > 0 && <span className="text-rose-700"> ({res.failed} fail)</span>}
        </div>
      </div>

      {/* Case list */}
      <details className="text-xs" open={res.failed > 0}>
        <summary className="cursor-pointer text-brand-700 hover:text-brand-900">
          {res.failed > 0 ? 'Showing failures (click to expand all)' : 'View all cases'}
        </summary>
        <ul className="mt-2 space-y-1.5">
          {res.cases
            .slice()
            .sort((a, b) => Number(a.passed) - Number(b.passed))
            .map(c => (
              <li key={c.name} className="border-l-2 pl-2"
                  style={{ borderColor: c.passed ? '#10b98166' : '#f43f5e' }}>
                <div className="flex items-center justify-between gap-2">
                  <span className={c.passed ? 'text-brand-900' : 'text-rose-700 font-medium'}>
                    {c.passed ? '✓' : '✗'} {c.name}
                  </span>
                  <span className="text-brand-400 font-mono">{c.duration_ms}ms</span>
                </div>
                {c.description && (
                  <div className="text-brand-700/70 ml-3">{c.description}</div>
                )}
                {c.error && (
                  <pre className="text-rose-700 ml-3 mt-1 whitespace-pre-wrap text-[10px]">{c.error}</pre>
                )}
                {c.metrics.map((m, i) => (
                  <div key={i} className="ml-3 mt-0.5 flex items-baseline gap-2 text-[11px]">
                    <span className={m.passed ? 'text-emerald-700' : 'text-rose-700'}>
                      {m.metric}
                    </span>
                    <span className="font-mono text-brand-700/70">
                      {m.score.toFixed(2)} / {m.threshold.toFixed(2)}
                    </span>
                    {m.reason && <span className="text-brand-700/80 italic">— {m.reason}</span>}
                  </div>
                ))}
              </li>
            ))}
        </ul>
      </details>
    </div>
  );
}
