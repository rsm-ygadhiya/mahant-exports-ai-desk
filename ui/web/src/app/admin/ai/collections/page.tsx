'use client';
import { AiRunPanel, Pill } from '@/components/admin/AiRunPanel';
import { fmtUsd } from '@/lib/format';
import type { CollectionResult, Bucket, Reminder } from '@/lib/ai-skills/collectionReminder';

const TONE: Record<Bucket, 'amber' | 'rose' | 'gold' | 'brand'> = {
  JUST_DUE: 'amber',
  AGING: 'gold',
  OVERDUE: 'rose',
  CRITICAL: 'rose',
};

export default function CollectionsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-3xl">💰 Collection Reminders</h1>
        <p className="text-sm text-brand-700">
          Buckets sales by days-since-sold (proxy for days-past-due) and drafts tone-appropriate reminders.
        </p>
        <div className="card p-3 bg-amber-50/40 border-amber-300 mt-3 text-xs text-amber-800">
          <b>Note:</b> This deployment doesn't yet have a formal invoice/payment ledger.
          The skill approximates collections by treating SOLD stones as deals where payment may be in transit (Net 30).
          Add a real invoicing module for production use.
        </div>
      </div>

      <AiRunPanel<CollectionResult>
        skill="collections"
        aiAllowed
        buttonLabel="Generate collection reminders"
        render={(r) => (
          <div className="space-y-4">
            <div className="card p-5 bg-gradient-to-br from-brand-700 to-brand-900 text-white">
              <p className="text-sm text-brand-100">{r.summary}</p>
            </div>

            {r.reminders.map((rem: Reminder, i) => (
              <div key={i} className="card p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <div className="font-medium">{rem.customerName}</div>
                    <div className="text-xs font-mono text-brand-700">
                      {rem.stoneId} · {fmtUsd(rem.amount)} · {rem.daysSinceSold}d ago
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Pill tone={TONE[rem.bucket]}>{rem.bucket.replace('_', ' ')}</Pill>
                    <span className="text-xs text-brand-700">{rem.tone}</span>
                  </div>
                </div>
                <div className="bg-brand-50 p-3 rounded text-sm">
                  <p className="whitespace-pre-wrap text-brand-900">{rem.draftMessage}</p>
                  <button onClick={() => navigator.clipboard.writeText(rem.draftMessage)}
                          className="mt-2 text-xs text-gold-600 hover:underline">
                    Copy reminder
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      />
    </div>
  );
}
