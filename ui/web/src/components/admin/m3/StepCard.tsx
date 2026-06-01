'use client';
import { useState } from 'react';
import type { Step } from './types';
import { STEP_META } from './types';

/**
 * One card per Daybreak step. Collapsed shows the headline; clicking
 * expands to a per-step top-10 preview with the action column + the
 * reason that drove it.
 */
export function StepCard({ step, isLast }: { step: Step; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  const meta = STEP_META[step.name];
  const env = step.envelope;
  const outputs = env.outputs ?? {};
  const ok = env.status === 'ok';
  const reviewNeeded = !!env.review_required;

  const chips = buildChips(outputs);

  return (
    <>
      <div className={`card p-4 transition cursor-pointer ${
          open ? 'ring-2 ring-gold-500/40' : 'hover:shadow-md'
        }`}
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-2xl">{meta.emoji}</span>
            <div className="min-w-0">
              <div className="font-medium text-brand-900 truncate">{meta.label}</div>
              <div className="text-xs text-brand-700 truncate">{meta.blurb}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {ok ? (
              <span className={`text-xs px-2 py-0.5 rounded ${reviewNeeded ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>
                {reviewNeeded ? '⚠ review' : '✓ ok'}
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded bg-rose-100 text-rose-700">✗ err</span>
            )}
            <span className="text-brand-700 text-xs">{open ? '▲' : '▼'}</span>
          </div>
        </div>

        {chips.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {chips.map((c, i) => (
              <span key={i} className={`text-xs px-2 py-0.5 rounded ${
                c.tone === 'green' ? 'bg-emerald-50 text-emerald-700'
                : c.tone === 'amber' ? 'bg-amber-50 text-amber-700'
                : c.tone === 'rose' ? 'bg-rose-50 text-rose-700'
                : 'bg-brand-50 text-brand-700'
              }`}>
                <b>{c.label}:</b> {c.value}
              </span>
            ))}
          </div>
        )}

        {open && (
          <div className="mt-4 space-y-3 border-t pt-3" onClick={e => e.stopPropagation()}>
            {step.decisions.length > 0 ? (
              <StepPreview step={step} />
            ) : (
              <p className="text-xs text-brand-700">No rows written by this step.</p>
            )}
            <details className="text-xs">
              <summary className="cursor-pointer text-brand-700 font-medium">Raw envelope JSON</summary>
              <pre className="mt-2 p-2 bg-brand-50/40 rounded text-[10px] leading-tight overflow-x-auto">
                {JSON.stringify(env, null, 2)}
              </pre>
            </details>
            {step.artifact && (
              <p className="text-[10px] text-brand-700/70">artifact: <span className="font-mono">{step.artifact}</span></p>
            )}
          </div>
        )}
      </div>

      {!isLast && (
        <div className="flex items-center justify-center text-2xl text-brand-700/40 -my-1">↓</div>
      )}
    </>
  );
}

function buildChips(outputs: Record<string, unknown>): { label: string; value: string; tone: 'green' | 'amber' | 'brand' | 'rose' }[] {
  const chips: { label: string; value: string; tone: 'green' | 'amber' | 'brand' | 'rose' }[] = [];
  const o = outputs;
  if (typeof o.stones_tagged === 'number')
    chips.push({ label: 'stones', value: String(o.stones_tagged), tone: 'brand' });
  if (o.by_tag && typeof o.by_tag === 'object')
    for (const [k, v] of Object.entries(o.by_tag))
      chips.push({ label: k, value: String(v), tone: k === 'CLEAR' || k === 'DISCOUNT' ? 'amber' : 'brand' });
  if (typeof o.auto_count === 'number')
    chips.push({ label: 'auto', value: String(o.auto_count), tone: 'green' });
  if (typeof o.review_count === 'number')
    chips.push({ label: 'review', value: String(o.review_count), tone: 'amber' });
  if (typeof o.auto_approved === 'number')
    chips.push({ label: 'auto-approved', value: String(o.auto_approved), tone: 'green' });
  if (typeof o.needs_review === 'number')
    chips.push({ label: 'needs review', value: String(o.needs_review), tone: 'amber' });
  if (typeof o.entities_ranked === 'number')
    chips.push({ label: 'entities', value: String(o.entities_ranked), tone: 'brand' });
  if (o.tier_counts && typeof o.tier_counts === 'object')
    for (const [k, v] of Object.entries(o.tier_counts))
      chips.push({ label: k, value: String(v), tone: 'brand' });
  if (typeof o.threshold_pct === 'number')
    chips.push({ label: 'threshold A', value: `±${o.threshold_pct}%`, tone: 'brand' });
  if (typeof o.opp_ceiling === 'number')
    chips.push({ label: 'opp ceiling', value: String(o.opp_ceiling), tone: 'brand' });
  return chips;
}

/**
 * Per-step top-10 preview, with the action column + reasoning surfaced.
 * Renders different columns per step so it actually reads like a desk
 * report, not a CSV dump.
 */
function StepPreview({ step }: { step: Step }) {
  const top = step.decisions.slice(0, 10);

  if (step.name === 'triage-inventory') {
    return (
      <PreviewTable
        title="Top 10 stones by urgency"
        rows={top}
        cols={[
          { key: 'stock_id',         label: 'Stone',          width: 'w-28' },
          { key: 'action_tag',       label: 'Tag',            width: 'w-24', pill: tagPill },
          { key: 'age_in_stock_days', label: 'Age (d)',       width: 'w-16', align: 'right' },
          { key: 'suggested_price_move_pct', label: 'Move %', width: 'w-20', align: 'right', fmt: (v) => v ? `${v}%` : '—' },
          { key: 'reason',           label: 'Reason',         width: '',     truncate: true },
        ]}
      />
    );
  }

  if (step.name === 'propose-repricing') {
    return (
      <PreviewTable
        title="Top 10 repricing proposals"
        rows={top}
        cols={[
          { key: 'stock_id',       label: 'Stone',         width: 'w-28' },
          { key: 'queue',          label: 'Queue',         width: 'w-20', pill: queuePill },
          { key: 'old_price',      label: 'Old $',         width: 'w-20', align: 'right', fmt: dollars },
          { key: 'proposed_price', label: 'New $',         width: 'w-20', align: 'right', fmt: dollars },
          { key: 'pct_change',     label: 'Δ %',           width: 'w-16', align: 'right', fmt: pctSigned },
          { key: 'primary_driver', label: 'Driver',        width: '',     truncate: true },
        ]}
      />
    );
  }

  if (step.name === 'rank-customer-clv') {
    return (
      <PreviewTable
        title="Top 10 customers by CLV"
        rows={top}
        cols={[
          { key: 'entity_id',     label: 'ID',         width: 'w-24' },
          { key: 'entity_name',   label: 'Name',       width: '' },
          { key: 'tier',          label: 'Tier',       width: 'w-20', pill: tierPill },
          { key: 'clv',           label: 'CLV',        width: 'w-28', align: 'right', fmt: dollars },
          { key: 'transactions',  label: 'Txns',       width: 'w-16', align: 'right' },
        ]}
      />
    );
  }

  if (step.name === 'decide-memo') {
    return (
      <PreviewTable
        title="Top 10 memo decisions"
        rows={top}
        cols={[
          { key: 'memo_id',     label: 'Memo',       width: 'w-24' },
          { key: 'queue',       label: 'Queue',      width: 'w-32', pill: queuePill },
          { key: 'decision',    label: 'Decision',   width: 'w-44', pill: decisionPill },
          { key: 'tier',        label: 'Tier',       width: 'w-20', pill: tierPill },
          { key: 'triage_tag',  label: 'Triage',     width: 'w-24', pill: tagPill },
          { key: 'rationale',   label: 'Why',        width: '',     truncate: true },
        ]}
      />
    );
  }

  // Fallback: plain JSON of the first row
  return <pre className="text-[10px]">{JSON.stringify(top[0], null, 2)}</pre>;
}

// ─── Generic preview table with per-column formatting + pill rendering ───
type Col = {
  key: string;
  label: string;
  width: string;
  align?: 'left' | 'right';
  truncate?: boolean;
  fmt?: (v: string) => string;
  pill?: (v: string) => { cls: string; label?: string };
};

function PreviewTable({ title, rows, cols }: { title: string; rows: Record<string, string>[]; cols: Col[] }) {
  return (
    <div>
      <div className="text-xs text-brand-700 mb-2 font-medium">{title}</div>
      <div className="overflow-x-auto border rounded">
        <table className="text-[11px] leading-tight w-full">
          <thead className="bg-brand-50/60">
            <tr>
              {cols.map(c => (
                <th key={c.key} className={`px-2 py-1 text-${c.align ?? 'left'} font-medium text-brand-700 whitespace-nowrap ${c.width}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t">
                {cols.map(c => {
                  const raw = r[c.key] ?? '';
                  const v = c.fmt ? c.fmt(raw) : raw;
                  if (c.pill) {
                    const p = c.pill(raw);
                    return (
                      <td key={c.key} className={`px-2 py-1 ${c.align === 'right' ? 'text-right' : ''}`}>
                        <span className={`text-[10px] px-2 py-0.5 rounded ${p.cls}`}>{p.label ?? v}</span>
                      </td>
                    );
                  }
                  return (
                    <td key={c.key} className={`px-2 py-1 ${c.align === 'right' ? 'text-right' : ''} ${c.truncate ? 'max-w-md truncate' : 'whitespace-nowrap'}`} title={c.truncate ? raw : undefined}>
                      {v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Formatters + pill stylers ───
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

function tagPill(v: string) {
  return {
    cls: v === 'CLEAR'    ? 'bg-rose-50 text-rose-700'
       : v === 'DISCOUNT' ? 'bg-amber-50 text-amber-700'
       : v === 'WATCH'    ? 'bg-brand-50 text-brand-700'
       : v === 'HOLD'     ? 'bg-emerald-50 text-emerald-700'
       : 'bg-brand-50 text-brand-700',
  };
}
function queuePill(v: string) {
  return {
    cls: v === 'auto' || v === 'auto_approve' ? 'bg-emerald-50 text-emerald-700' :
         v === 'review' || v === 'needs_review' ? 'bg-amber-50 text-amber-700' :
         'bg-brand-50 text-brand-700',
  };
}
function tierPill(v: string) {
  return {
    cls: v === 'Top'  ? 'bg-gold-500/10 text-gold-700' :
         v === 'High' ? 'bg-emerald-50 text-emerald-700' :
         v === 'Mid'  ? 'bg-brand-50 text-brand-700' :
         v === 'Low'  ? 'bg-rose-50 text-rose-700' :
         'bg-brand-50 text-brand-700',
  };
}
function decisionPill(v: string) {
  return {
    cls: v === 'APPROVE' ? 'bg-emerald-50 text-emerald-700' :
         v === 'REJECT'  ? 'bg-rose-50 text-rose-700' :
         v === 'APPROVE_WITH_CONDITIONS' ? 'bg-amber-50 text-amber-700' :
         'bg-brand-50 text-brand-700',
  };
}
