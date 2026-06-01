'use client';
import { useState } from 'react';
import type { Step } from './types';

type SummaryCol = {
  key: string;
  label: string;
  align?: 'left' | 'right';
  truncate?: boolean;
  fmt?: (v: string) => string;
  pill?: (v: string) => string;
};

/**
 * Compact summary card for one of the three upstream automations
 * (triage, repricing, CLV). Shows what the step did at a glance with
 * an expandable "show top 10" affordance for the detail-curious.
 *
 * The memo step has its own component (`MemoOutcomes`) since it's the
 * star of the show.
 */
export function StepSummary({ step }: { step: Step }) {
  const [open, setOpen] = useState(false);
  const env = step.envelope;
  const o = env.outputs ?? {};
  const rows = step.decisions.slice(0, 10);

  // Per-step headline + accent + preview columns
  const cfg: { emoji: string; title: string; headline: string; cols: SummaryCol[] } | null = (() => {
    switch (step.name) {
      case 'triage-inventory':
        return {
          emoji: '⏳',
          title: 'Aged & tagged stones',
          headline: byTagHeadline(o.by_tag as Record<string, number> | undefined,
                                  o.stones_tagged as number | undefined),
          cols: [
            { key: 'stock_id',           label: 'Stone' },
            { key: 'action_tag',         label: 'Tag',     pill: tagPill },
            { key: 'age_in_stock_days',  label: 'Age (d)', align: 'right' },
            { key: 'reason',             label: 'Reason',  truncate: true },
          ] as SummaryCol[],
        };
      case 'propose-repricing':
        return {
          emoji: '💎',
          title: 'Repricing proposals',
          headline: `${o.auto_count ?? 0} auto-applied · ${o.review_count ?? 0} need review`,
          cols: [
            { key: 'stock_id',       label: 'Stone' },
            { key: 'queue',          label: 'Queue', pill: queuePill },
            { key: 'old_price',      label: 'Old $',  align: 'right', fmt: dollars },
            { key: 'proposed_price', label: 'New $',  align: 'right', fmt: dollars },
            { key: 'pct_change',     label: 'Δ',      align: 'right', fmt: pctSigned },
            { key: 'primary_driver', label: 'Why',    truncate: true },
          ] as SummaryCol[],
        };
      case 'rank-customer-clv':
        return {
          emoji: '👑',
          title: 'CLV tiers refreshed',
          headline: tierHeadline(o.tier_counts as Record<string, number> | undefined),
          cols: [
            { key: 'entity_id',    label: 'ID' },
            { key: 'entity_name',  label: 'Name' },
            { key: 'tier',         label: 'Tier', pill: tierPill },
            { key: 'clv',          label: 'CLV',  align: 'right', fmt: dollars },
          ] as SummaryCol[],
        };
      default:
        return null;
    }
  })();

  if (!cfg) return null;

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full p-3 flex items-center justify-between hover:bg-brand-50/40 transition"
      >
        <div className="flex items-center gap-3 text-left min-w-0">
          <span className="text-2xl">{cfg.emoji}</span>
          <div className="min-w-0">
            <div className="font-medium text-brand-900">{cfg.title}</div>
            <div className="text-xs text-brand-700 truncate">{cfg.headline}</div>
          </div>
        </div>
        <span className="text-brand-700 text-xs ml-2">{open ? '▲ hide' : `▼ top 10`}</span>
      </button>

      {open && rows.length > 0 && (
        <div className="border-t overflow-x-auto">
          <table className="text-[11px] leading-tight w-full">
            <thead className="bg-brand-50/60">
              <tr>
                {cfg.cols.map(c => (
                  <th key={c.key} className={`px-2 py-1 text-${c.align ?? 'left'} font-medium text-brand-700 whitespace-nowrap`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t">
                  {cfg.cols.map(c => {
                    const raw = r[c.key] ?? '';
                    const v = c.fmt ? c.fmt(raw) : raw;
                    if (c.pill) {
                      const cls = c.pill(raw);
                      return (
                        <td key={c.key} className={`px-2 py-1 ${c.align === 'right' ? 'text-right' : ''}`}>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${cls}`}>{v}</span>
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
      )}
    </div>
  );
}

// ─── headline formatters ───
function byTagHeadline(by_tag?: Record<string, number>, total?: number): string {
  if (!by_tag) return total ? `${total} stones tagged` : '';
  const parts = Object.entries(by_tag).map(([k, v]) => `${v} ${k}`);
  return `${total ?? Object.values(by_tag).reduce((a, b) => a + b, 0)} stones — ${parts.join(' · ')}`;
}
function tierHeadline(tier_counts?: Record<string, number>): string {
  if (!tier_counts) return '';
  return Object.entries(tier_counts).map(([k, v]) => `${v} ${k}`).join(' · ');
}

// ─── cell formatters ───
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

// ─── pill stylers ───
function tagPill(v: string): string {
  return v === 'CLEAR'    ? 'bg-rose-50 text-rose-700'
       : v === 'DISCOUNT' ? 'bg-amber-50 text-amber-700'
       : v === 'WATCH'    ? 'bg-brand-50 text-brand-700'
       : v === 'HOLD'     ? 'bg-emerald-50 text-emerald-700'
       : 'bg-brand-50 text-brand-700';
}
function queuePill(v: string): string {
  return v === 'auto' ? 'bg-emerald-50 text-emerald-700'
       : v === 'review' ? 'bg-amber-50 text-amber-700'
       : 'bg-brand-50 text-brand-700';
}
function tierPill(v: string): string {
  return v === 'Top'  ? 'bg-gold-500/10 text-gold-700'
       : v === 'High' ? 'bg-emerald-50 text-emerald-700'
       : v === 'Mid'  ? 'bg-brand-50 text-brand-700'
       : v === 'Low'  ? 'bg-rose-50 text-rose-700'
       : 'bg-brand-50 text-brand-700';
}
