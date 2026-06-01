'use client';
import { useEffect, useRef, useState } from 'react';
import type { RunBody } from './types';

const TIERS = ['Top', 'High', 'Mid', 'Low'] as const;

/**
 * Compact gear-icon popover that hides the threshold knobs out of the
 * main view. The desk sets these once during onboarding and only
 * reopens this if they want to tighten / loosen the auto-approve
 * thresholds for a specific run.
 */
export function SettingsPopover({
  body,
  setBody,
}: {
  body: RunBody;
  setBody: (b: RunBody) => void;
}) {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const thresholdPct = body.thresholdPct ?? 7;
  const oppCeiling = body.oppCeiling ?? 70;
  const autoTiers = body.autoTiers ?? ['Top', 'High'];

  return (
    <div className="relative" ref={popRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className="text-xs px-3 py-1.5 rounded border border-brand-200 text-brand-700 hover:bg-brand-50"
        title="Auto-approve thresholds"
      >
        ⚙ Auto-approve rules
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 card p-4 z-10 space-y-3 shadow-lg bg-white">
          <div className="text-xs text-brand-700">
            Tighter rules → more requests routed to a human for sign-off.
          </div>

          {/* Threshold A */}
          <div>
            <div className="flex items-baseline justify-between text-xs">
              <label className="text-brand-700 font-medium">Repricing |% change| ceiling</label>
              <span className="font-mono text-brand-900">{thresholdPct.toFixed(1)}%</span>
            </div>
            <input
              type="range" min="0" max="20" step="0.5"
              value={thresholdPct}
              onChange={e => setBody({ ...body, thresholdPct: parseFloat(e.target.value) })}
              className="w-full"
            />
            <p className="text-[10px] text-brand-700/70">
              Any price change bigger than ±this routes to the human queue.
            </p>
          </div>

          {/* Threshold B */}
          <div>
            <div className="flex items-baseline justify-between text-xs">
              <label className="text-brand-700 font-medium">Memo opportunity-cost ceiling</label>
              <span className="font-mono text-brand-900">{oppCeiling}</span>
            </div>
            <input
              type="range" min="0" max="100" step="5"
              value={oppCeiling}
              onChange={e => setBody({ ...body, oppCeiling: parseInt(e.target.value, 10) })}
              className="w-full"
            />
            <p className="text-[10px] text-brand-700/70">
              Memos on stones with buyers waiting (high opp-cost) go to a human even for top tiers.
            </p>
          </div>

          {/* Auto-approve tiers */}
          <div>
            <div className="text-xs text-brand-700 font-medium mb-1">
              Tiers eligible for auto-approve:
            </div>
            <div>
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
          </div>
        </div>
      )}
    </div>
  );
}
