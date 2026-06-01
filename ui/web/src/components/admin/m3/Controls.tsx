'use client';
import type { RunBody } from './types';

const SCENARIOS = [
  { id: '',                              label: 'Current data' },
  { id: 'scenario_a_normal_day',         label: 'A · Normal day (+1d)' },
  { id: 'scenario_b_monday_rap_drop',    label: 'B · Monday Rap drop (+7d)' },
  { id: 'scenario_c_month_end_stress',   label: 'C · Month-end stress (+30d)' },
];

const TIERS = ['Top', 'High', 'Mid', 'Low'] as const;

export function Controls({
  body,
  setBody,
  hitl,
  setHitl,
  busy,
  onRun,
}: {
  body: RunBody;
  setBody: (b: RunBody) => void;
  hitl: boolean;
  setHitl: (h: boolean) => void;
  busy: boolean;
  onRun: () => void;
}) {
  const thresholdPct = body.thresholdPct ?? 7;
  const oppCeiling = body.oppCeiling ?? 70;
  const autoTiers = body.autoTiers ?? ['Top', 'High'];

  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="font-serif text-lg">Workflow controls</div>
          <p className="text-xs text-brand-700">
            Tighten the thresholds → more items route to the human review queue.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* HITL toggle */}
          <div className="flex rounded border overflow-hidden text-xs">
            <button
              onClick={() => setHitl(true)}
              className={`px-3 py-1 ${hitl ? 'bg-brand-700 text-white' : 'bg-white text-brand-700'}`}
            >
              👤 HITL
            </button>
            <button
              onClick={() => setHitl(false)}
              className={`px-3 py-1 ${!hitl ? 'bg-brand-700 text-white' : 'bg-white text-brand-700'}`}
            >
              🤖 Full auto
            </button>
          </div>
          <button onClick={onRun} disabled={busy} className="btn-primary">
            {busy ? '⏳ Running…' : '▶ Run workflow'}
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Threshold A — repricing */}
        <div className="space-y-1">
          <label className="text-xs text-brand-700 font-medium">
            Repricing |% change| auto-apply threshold
            <span className="ml-2 font-mono text-brand-900">{thresholdPct.toFixed(1)}%</span>
          </label>
          <input
            type="range" min="0" max="20" step="0.5"
            value={thresholdPct}
            onChange={e => setBody({ ...body, thresholdPct: parseFloat(e.target.value) })}
            className="w-full"
          />
          <p className="text-[10px] text-brand-700/70">
            Decision point A — anything beyond ±this routes to review (also FROZEN / MARGIN / QUOTE flagged stones).
          </p>
        </div>

        {/* Threshold B — memo opp-ceiling */}
        <div className="space-y-1">
          <label className="text-xs text-brand-700 font-medium">
            Memo opportunity-score ceiling for auto-approve
            <span className="ml-2 font-mono text-brand-900">{oppCeiling}</span>
          </label>
          <input
            type="range" min="0" max="100" step="5"
            value={oppCeiling}
            onChange={e => setBody({ ...body, oppCeiling: parseInt(e.target.value, 10) })}
            className="w-full"
          />
          <p className="text-[10px] text-brand-700/70">
            Decision point B — memos on contested stones (opp_score above this) go to a human, even for top customers.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div>
          <span className="text-xs text-brand-700 font-medium mr-2">Auto-approve memo tiers:</span>
          {TIERS.map(t => {
            const on = autoTiers.includes(t);
            return (
              <button key={t}
                onClick={() => setBody({
                  ...body,
                  autoTiers: on ? autoTiers.filter(x => x !== t) : [...autoTiers, t],
                })}
                className={`text-xs px-2 py-0.5 rounded mr-1 border ${
                  on ? 'bg-gold-500/10 border-gold-500 text-gold-700' : 'border-brand-200 text-brand-700'
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <label className="text-xs text-brand-700 font-medium">Scenario:</label>
          <select
            value={body.scenario ?? ''}
            onChange={e => setBody({ ...body, scenario: e.target.value || undefined })}
            className="text-xs border rounded px-2 py-1"
          >
            {SCENARIOS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>

          <label className="text-xs text-brand-700 font-medium ml-2">Today:</label>
          <input
            type="date"
            value={body.today ?? ''}
            onChange={e => setBody({ ...body, today: e.target.value || undefined })}
            className="text-xs border rounded px-2 py-1"
          />
        </div>
      </div>
    </div>
  );
}
