'use client';
import { useState } from 'react';
import { AiRunPanel, Pill } from '@/components/admin/AiRunPanel';
import type { TriageResult, TriageTag } from '@/lib/ai-skills/agingTriage';

const TAG_TONE: Record<TriageTag, 'green' | 'amber' | 'gold' | 'rose'> = {
  HOLD: 'green',
  WATCH: 'amber',
  DISCOUNT: 'gold',
  CLEAR: 'rose',
};

export default function AgingPage() {
  const [filter, setFilter] = useState<TriageTag | 'ALL'>('ALL');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-3xl">⏳ Inventory Aging Triage</h1>
        <p className="text-sm text-brand-700">
          Tags every available stone HOLD / WATCH / DISCOUNT / CLEAR with reasoning + suggested action.
        </p>
      </div>

      <AiRunPanel<TriageResult>
        skill="aging"
        buttonLabel="Triage available stock"
        render={(r) => {
          const counts = { HOLD: 0, WATCH: 0, DISCOUNT: 0, CLEAR: 0 } as Record<TriageTag, number>;
          for (const it of r.items) counts[it.tag]++;
          const filtered = filter === 'ALL' ? r.items : r.items.filter(it => it.tag === filter);
          return (
            <div className="space-y-4">
              <div className="card p-5 bg-gradient-to-br from-brand-700 to-brand-900 text-white">
                <p className="text-sm text-brand-100">{r.summary}</p>
              </div>

              <div className="flex gap-2 flex-wrap">
                {(['ALL', 'HOLD', 'WATCH', 'DISCOUNT', 'CLEAR'] as const).map(t => (
                  <button key={t} onClick={() => setFilter(t)}
                          className={filter === t ? 'btn-primary' : 'btn-outline'}>
                    {t === 'ALL' ? `All (${r.items.length})` : `${t} (${counts[t as TriageTag]})`}
                  </button>
                ))}
              </div>

              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-brand-50 text-brand-700 text-left">
                    <tr>
                      <th className="px-3 py-2">Stone</th>
                      <th className="px-3 py-2">Tag</th>
                      <th className="px-3 py-2">Reason</th>
                      <th className="px-3 py-2 text-right">Suggested ∆ %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(it => (
                      <tr key={it.stoneId} className="border-t border-brand-100">
                        <td className="px-3 py-2 font-mono text-xs">{it.stoneId}</td>
                        <td className="px-3 py-2"><Pill tone={TAG_TONE[it.tag]}>{it.tag}</Pill></td>
                        <td className="px-3 py-2">{it.reason}</td>
                        <td className="px-3 py-2 text-right font-medium">
                          {it.suggestedDiscountPct != null ? `${it.suggestedDiscountPct.toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }}
      />
    </div>
  );
}
