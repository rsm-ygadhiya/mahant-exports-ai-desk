'use client';
import { AiRunPanel, Pill } from '@/components/admin/AiRunPanel';
import { fmtUsd } from '@/lib/format';
import type { NegotiationResponse, Decision } from '@/lib/ai-skills/quoteNegotiation';

const TONE: Record<Decision, 'green' | 'amber' | 'gold' | 'rose' | 'brand'> = {
  ACCEPT: 'green',
  COUNTER: 'gold',
  HOLD: 'brand',
  WALK_AWAY: 'rose',
  ESCALATE: 'amber',
};

export default function QuotePage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-3xl">🤝 Quote Negotiation</h1>
        <p className="text-sm text-brand-700">
          For every open enquiry: ACCEPT / COUNTER / HOLD / WALK_AWAY / ESCALATE — with reasoning and a drafted reply you can copy verbatim.
        </p>
      </div>

      <AiRunPanel<{ responses: NegotiationResponse[]; summary: string }>
        skill="quote"
        aiAllowed
        buttonLabel="Review open enquiries"
        render={(r) => (
          <div className="space-y-4">
            <div className="card p-5 bg-gradient-to-br from-brand-700 to-brand-900 text-white">
              <p className="text-sm text-brand-100">{r.summary}</p>
            </div>

            {r.responses.map((resp) => (
              <div key={resp.enquiryId} className="card p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <div className="font-medium">{resp.customerName}</div>
                    <div className="text-xs text-brand-700 font-mono">{resp.enquiryId}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Pill tone={TONE[resp.decision]}>{resp.decision}</Pill>
                    {resp.counterPpc != null && (
                      <span className="text-sm text-brand-900 font-medium">
                        Counter: {fmtUsd(resp.counterPpc)}/ct
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-sm text-brand-700 mb-3">
                  <b>Reasoning:</b> {resp.reasoning}
                </div>
                <div className="bg-brand-50 p-3 rounded text-sm">
                  <div className="text-xs uppercase tracking-widest text-brand-700 mb-1">Drafted reply</div>
                  <p className="whitespace-pre-wrap text-brand-900">{resp.draftReply}</p>
                  <button
                    onClick={() => navigator.clipboard.writeText(resp.draftReply)}
                    className="mt-2 text-xs text-gold-600 hover:underline">
                    Copy reply
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
