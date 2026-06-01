'use client';
import { AiRunPanel, Pill } from '@/components/admin/AiRunPanel';
import type { ForecastResult, GapItem } from '@/lib/ai-skills/demandForecast';

const SEV_TONE = { CRITICAL: 'rose', NOTABLE: 'amber', MINOR: 'brand' } as const;

function ItemList({ items, kind }: { items: GapItem[]; kind: 'gap' | 'surplus' }) {
  if (items.length === 0) return <div className="card p-6 text-center text-brand-700 text-sm">None identified.</div>;
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i} className="card p-4">
          <div className="flex items-center gap-2 mb-1">
            <Pill tone={SEV_TONE[it.severity]}>{it.severity}</Pill>
            <span className="font-mono text-sm text-brand-900">{it.category}</span>
          </div>
          <div className="text-sm text-brand-700"><b>Why:</b> {it.reason}</div>
          <div className="text-sm text-brand-900 mt-1">
            <b>Action:</b> {it.recommendation}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DemandPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-3xl">📈 Demand Forecast</h1>
        <p className="text-sm text-brand-700">
          Identifies sourcing gaps (under-stocked categories with strong enquiry signal) and surpluses (over-stocked, weak demand).
        </p>
      </div>

      <AiRunPanel<ForecastResult>
        skill="demand"
        buttonLabel="Run demand forecast"
        render={(r) => (
          <div className="space-y-6">
            <div className="card p-5 bg-gradient-to-br from-brand-700 to-brand-900 text-white">
              <p className="text-sm text-brand-100">{r.summary}</p>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              <div>
                <h2 className="font-serif text-xl mb-3 flex items-center gap-2">
                  <span className="text-rose-700">⚠</span> Sourcing gaps
                  <span className="text-sm text-brand-700 font-sans">({r.gaps.length})</span>
                </h2>
                <ItemList items={r.gaps} kind="gap" />
              </div>
              <div>
                <h2 className="font-serif text-xl mb-3 flex items-center gap-2">
                  <span className="text-amber-600">📦</span> Surpluses
                  <span className="text-sm text-brand-700 font-sans">({r.surpluses.length})</span>
                </h2>
                <ItemList items={r.surpluses} kind="surplus" />
              </div>
            </div>
          </div>
        )}
      />
    </div>
  );
}
