'use client';
import { AiRunPanel, Pill } from '@/components/admin/AiRunPanel';
import type { ThreadsResult, ThreadSummary } from '@/lib/ai-skills/negotiationThreads';

const TONE: Record<ThreadSummary['status'], 'green' | 'amber' | 'gold' | 'rose' | 'brand'> = {
  OPEN: 'gold',
  STALLED: 'rose',
  WARM: 'amber',
  CLOSED_WON: 'green',
  CLOSED_LOST: 'brand',
};

export default function ThreadsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-3xl">🧵 Negotiation Threads</h1>
        <p className="text-sm text-brand-700">
          Summarizes every enquiry thread with status, daysSinceLastTouch, and a recommended next action.
        </p>
      </div>

      <AiRunPanel<ThreadsResult>
        skill="threads"
        aiAllowed
        buttonLabel="Summarize all threads"
        render={(r) => (
          <div className="space-y-4">
            <div className="card p-5 bg-gradient-to-br from-brand-700 to-brand-900 text-white">
              <p className="text-sm text-brand-100">{r.summary}</p>
            </div>

            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-brand-50 text-brand-700 text-left">
                  <tr>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Age</th>
                    <th className="px-3 py-2">Where it stands</th>
                    <th className="px-3 py-2">Next action</th>
                  </tr>
                </thead>
                <tbody>
                  {r.threads.map((t) => (
                    <tr key={t.enquiryId} className="border-t border-brand-100 align-top">
                      <td className="px-3 py-2 font-medium">{t.customerName}</td>
                      <td className="px-3 py-2"><Pill tone={TONE[t.status]}>{t.status}</Pill></td>
                      <td className="px-3 py-2 text-xs">{t.daysSinceLastTouch}d</td>
                      <td className="px-3 py-2 text-sm">{t.oneLineSummary}</td>
                      <td className="px-3 py-2 text-sm font-medium">{t.nextAction}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      />
    </div>
  );
}
