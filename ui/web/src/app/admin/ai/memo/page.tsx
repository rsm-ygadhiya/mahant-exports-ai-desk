'use client';
import { AiRunPanel, Pill } from '@/components/admin/AiRunPanel';
import type { MemoReview, MemoDecision } from '@/lib/ai-skills/memoApproval';

const META: Record<MemoDecision, { tone: 'green' | 'amber' | 'rose'; label: string; blurb: string }> = {
  AUTO_APPROVE: { tone: 'green', label: '✅ Auto-approved', blurb: 'Healthy holds — kept in place.' },
  NEEDS_REVIEW: { tone: 'amber', label: '⚠ Needs your sign-off', blurb: 'Mid-CLV customers tying up multiple stones.' },
  AUTO_REJECT:  { tone: 'rose',  label: '❌ Auto-released', blurb: 'Released back to AVAILABLE.' },
};
const ORDER: MemoDecision[] = ['NEEDS_REVIEW', 'AUTO_REJECT', 'AUTO_APPROVE'];

export default function MemoPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-3xl">📝 Memo Approval Review</h1>
        <p className="text-sm text-brand-700">
          Reviews every stone on memo (HOLD) and routes each into auto-approve, needs sign-off, or auto-release —
          the same FIFO + human-in-the-loop gate the autopilot uses.
        </p>
      </div>

      <AiRunPanel<{ reviews: MemoReview[]; summary: string }>
        skill="memo"
        buttonLabel="Review all memos"
        render={(r) => {
          const buckets = ORDER
            .map((d) => ({ decision: d, rows: r.reviews.filter((rv) => rv.decision === d) }))
            .filter((b) => b.rows.length > 0);

          return (
            <div className="space-y-4">
              {/* Summary banner with counts */}
              <div className="card p-5 bg-gradient-to-br from-brand-700 to-brand-900 text-white space-y-3">
                <p className="text-sm text-brand-100">{r.summary}</p>
                <div className="flex flex-wrap gap-2">
                  {ORDER.map((d) => (
                    <span key={d} className="text-xs px-2 py-0.5 rounded bg-white/15">
                      {META[d].label} · {r.reviews.filter((rv) => rv.decision === d).length}
                    </span>
                  ))}
                </div>
              </div>

              {/* One grouped section per bucket */}
              {buckets.map(({ decision, rows }) => (
                <div key={decision} className="card overflow-hidden">
                  <div className="px-4 py-3 border-b border-brand-100 flex items-center justify-between">
                    <div>
                      <span className="font-medium text-brand-900">{META[decision].label}</span>
                      <span className="text-xs text-brand-700 ml-2">{META[decision].blurb}</span>
                    </div>
                    <Pill tone={META[decision].tone}>{rows.length}</Pill>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-brand-50 text-brand-700 text-left">
                        <tr>
                          <th className="px-3 py-2">Stone</th>
                          <th className="px-3 py-2">Customer</th>
                          <th className="px-3 py-2">Reasoning</th>
                          <th className="px-3 py-2">Next action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((rv) => (
                          <tr key={rv.stoneId} className="border-t border-brand-100 align-top">
                            <td className="px-3 py-2 font-mono text-xs">{rv.stoneId}</td>
                            <td className="px-3 py-2">{rv.customerName}</td>
                            <td className="px-3 py-2 text-sm">{rv.reasoning}</td>
                            <td className="px-3 py-2 text-sm">{rv.conditions ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          );
        }}
      />
    </div>
  );
}
