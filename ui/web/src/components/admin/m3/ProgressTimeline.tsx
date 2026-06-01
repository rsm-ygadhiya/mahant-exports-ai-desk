'use client';
import type { StepName } from './types';
import { STEP_META } from './types';

export type StepStatus = 'pending' | 'running' | 'done' | 'error';

/**
 * Top-of-page horizontal progress strip. Each of the 4 steps lights
 * up from grey → blue (running, pulse) → green (done) so the user
 * actually watches the routine tick through, rather than seeing one
 * lump of result.
 */
export function ProgressTimeline({
  statuses,
  durations,
  active,
}: {
  statuses: Record<StepName, StepStatus>;
  durations: Record<StepName, number | undefined>;
  active: StepName | null;
}) {
  const steps: StepName[] = ['triage-inventory', 'propose-repricing', 'rank-customer-clv', 'decide-memo'];
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-xs uppercase tracking-widest text-brand-700">Today's run</div>
        {active && (
          <div className="text-xs text-brand-700 animate-pulse">
            ▸ {STEP_META[active].label}…
          </div>
        )}
      </div>
      <div className="flex items-center">
        {steps.map((name, i) => {
          const status = statuses[name];
          const meta = STEP_META[name];
          const duration = durations[name];
          return (
            <div key={name} className="flex items-center flex-1 last:flex-none">
              <StepDot name={name} meta={meta} status={status} duration={duration} />
              {i < steps.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 transition-colors ${
                  statuses[name] === 'done' ? 'bg-emerald-400' : 'bg-brand-200'
                }`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepDot({
  name, meta, status, duration,
}: {
  name: StepName;
  meta: { label: string; emoji: string };
  status: StepStatus;
  duration: number | undefined;
}) {
  const ringCls =
    status === 'done'    ? 'bg-emerald-100 ring-2 ring-emerald-400'
  : status === 'running' ? 'bg-brand-100 ring-2 ring-brand-700 animate-pulse'
  : status === 'error'   ? 'bg-rose-100 ring-2 ring-rose-500'
  :                        'bg-brand-50 ring-1 ring-brand-200';
  const iconCls =
    status === 'done'    ? 'text-emerald-700'
  : status === 'running' ? 'text-brand-900'
  : status === 'error'   ? 'text-rose-700'
  :                        'text-brand-700/60';
  const labelCls =
    status === 'done' || status === 'running' ? 'text-brand-900' : 'text-brand-700/60';

  return (
    <div className="flex flex-col items-center text-center min-w-0">
      <div className={`h-10 w-10 rounded-full flex items-center justify-center ${ringCls}`}>
        {status === 'done' ? <span className="text-emerald-700">✓</span>
        : status === 'running' ? <span className={iconCls}>{meta.emoji}</span>
        : status === 'error' ? <span className="text-rose-700">✗</span>
        : <span className={iconCls}>{meta.emoji}</span>}
      </div>
      <div className={`text-[11px] mt-1 truncate max-w-[10rem] ${labelCls}`}>{meta.label}</div>
      <div className="text-[10px] text-brand-700/60 h-3">
        {status === 'done' && duration != null && `${(duration / 1000).toFixed(1)}s`}
        {status === 'running' && '…'}
      </div>
    </div>
  );
}
