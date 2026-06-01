'use client';
import { useMemo, useState } from 'react';
import type { Step } from './types';
import { STEP_META } from './types';

type Verdict = 'approved' | 'rejected' | null;

/**
 * Bottom-of-page table of every row whose `queue` column says it needs a human.
 * Per-row Approve / Reject buttons live in component state — they don't
 * persist across reloads, which is enough for a live demo. (Wire to Postgres
 * later if you want an audit trail.)
 */
export function ReviewQueue({ steps, hitl }: { steps: Step[]; hitl: boolean }) {
  // Collect every row that the upstream skill flagged for review
  const queueItems = useMemo(() => {
    const items: { stepName: string; row: Record<string, string>; rowKey: string }[] = [];
    for (const step of steps) {
      const meta = STEP_META[step.name];
      if (!meta.queueColumn || !meta.reviewValues) continue;
      for (const row of step.decisions) {
        if (meta.reviewValues.includes(row[meta.queueColumn])) {
          const id = row.memo_id || row.stock_id || row.entity_id || JSON.stringify(row).slice(0, 24);
          items.push({ stepName: step.name, row, rowKey: `${step.name}:${id}` });
        }
      }
    }
    return items;
  }, [steps]);

  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const decided = Object.values(verdicts).filter(v => v !== null).length;

  if (queueItems.length === 0) {
    return (
      <div className="card p-6 text-center">
        <div className="text-3xl mb-2">✅</div>
        <div className="font-serif text-lg">All clear — nothing needs human review.</div>
        <p className="text-sm text-brand-700 mt-1">
          Every decision in this run was within the configured thresholds and auto-applied.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="font-serif text-lg">⚠ Human Review Queue</div>
          <p className="text-xs text-brand-700">
            {queueItems.length} row(s) routed to a human because the threshold gates didn't pass.
            {hitl && decided > 0 && <> · {decided} reviewed</>}
          </p>
        </div>
        {!hitl && (
          <span className="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">
            Full-auto mode — these would be silently auto-applied
          </span>
        )}
      </div>
      <div className="overflow-x-auto border rounded">
        <table className="text-[11px] leading-tight w-full">
          <thead className="bg-amber-50/60">
            <tr>
              <th className="px-2 py-1 text-left font-medium text-brand-700">step</th>
              <th className="px-2 py-1 text-left font-medium text-brand-700">id</th>
              <th className="px-2 py-1 text-left font-medium text-brand-700">decision / reason</th>
              <th className="px-2 py-1 text-left font-medium text-brand-700">key scores</th>
              {hitl && <th className="px-2 py-1 text-left font-medium text-brand-700">action</th>}
            </tr>
          </thead>
          <tbody>
            {queueItems.map(({ stepName, row, rowKey }) => {
              const v = verdicts[rowKey] ?? null;
              const id = row.memo_id || row.stock_id || row.entity_id || '';
              const decision = row.decision || row.action_tag || row.tier || '';
              const reason = row.reason || row.rationale || row.primary_driver || '';
              const scores: string[] = [];
              if (row.reliability_score) scores.push(`rel ${row.reliability_score}`);
              if (row.opportunity_score) scores.push(`opp ${row.opportunity_score}`);
              if (row.pct_change) scores.push(`Δ ${row.pct_change}%`);
              if (row.tier) scores.push(`tier ${row.tier}`);
              if (row.triage_tag) scores.push(row.triage_tag);
              return (
                <tr key={rowKey} className={`border-t ${
                  v === 'approved' ? 'bg-emerald-50/40'
                  : v === 'rejected' ? 'bg-rose-50/40'
                  : ''
                }`}>
                  <td className="px-2 py-1 whitespace-nowrap">{STEP_META[stepName as keyof typeof STEP_META]?.emoji} {stepName}</td>
                  <td className="px-2 py-1 font-mono whitespace-nowrap">{id}</td>
                  <td className="px-2 py-1">
                    <div className="font-medium">{decision}</div>
                    <div className="text-brand-700/70 truncate max-w-md" title={reason}>{reason}</div>
                  </td>
                  <td className="px-2 py-1 text-brand-700 whitespace-nowrap">{scores.join(' · ')}</td>
                  {hitl && (
                    <td className="px-2 py-1 whitespace-nowrap">
                      {v === null ? (
                        <div className="flex gap-1">
                          <button
                            className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] hover:bg-emerald-700"
                            onClick={() => setVerdicts(prev => ({ ...prev, [rowKey]: 'approved' }))}
                          >
                            Approve
                          </button>
                          <button
                            className="px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] hover:bg-rose-700"
                            onClick={() => setVerdicts(prev => ({ ...prev, [rowKey]: 'rejected' }))}
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <button
                          className="text-[10px] underline text-brand-700"
                          onClick={() => setVerdicts(prev => ({ ...prev, [rowKey]: null }))}
                        >
                          undo ({v})
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
