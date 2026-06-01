'use client';
import Link from 'next/link';
import { AiRunPanel, Pill } from '@/components/admin/AiRunPanel';
import type { BriefingResult, BriefingItem } from '@/lib/ai-skills/morningBriefing';

const PRIO_TONE = { HIGH: 'rose', MEDIUM: 'amber', LOW: 'brand' } as const;

function ItemCard({ item }: { item: BriefingItem }) {
  const inner = (
    <>
      <div className="flex items-center gap-2 mb-1">
        <Pill tone={PRIO_TONE[item.priority]}>{item.priority}</Pill>
        <span className="text-xs uppercase tracking-widest text-brand-700">{item.category}</span>
        {item.href && (
          <span className="ml-auto text-xs text-brand-700/70 group-hover:text-brand-900">Open →</span>
        )}
      </div>
      <div className="text-brand-900 font-medium">{item.action}</div>
      <div className="text-sm text-brand-700 mt-1">{item.context}</div>
      {item.details && item.details.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-brand-100 pt-2">
          {item.details.map((d, i) => (
            <li key={i}>
              <Link
                href={d.href}
                onClick={(e) => e.stopPropagation()}
                className="text-xs text-brand-700 hover:text-brand-900 hover:underline flex items-center gap-1"
              >
                <span className="text-brand-700/50">→</span>{d.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
  if (item.href) {
    return (
      <Link
        href={item.href}
        className="card p-4 block group hover:bg-brand-50/40 hover:ring-1 hover:ring-brand-200 transition"
      >
        {inner}
      </Link>
    );
  }
  return <div className="card p-4">{inner}</div>;
}

export default function BriefingPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-3xl">🌅 Morning Briefing</h1>
        <p className="text-sm text-brand-700">Daily prioritized to-do list, generated from current desk state.</p>
      </div>

      <AiRunPanel<BriefingResult>
        skill="briefing"
        buttonLabel="Generate today's briefing"
        description="Pulls stock, enquiries, customers, and stale memos and asks Claude for the prioritized list of what to do today."
        render={(b) => (
          <div className="space-y-6">
            <div className="card p-6 bg-gradient-to-br from-brand-700 to-brand-900 text-white">
              <p className="font-serif text-xl">{b.greeting}</p>
              <p className="text-sm text-brand-100 mt-2">{b.summary}</p>
            </div>

            <div>
              <h2 className="font-serif text-xl mb-3">Top priorities</h2>
              <div className="grid md:grid-cols-2 gap-3">
                {b.topPriorities.map((it, i) => <ItemCard key={i} item={it} />)}
              </div>
            </div>

            <div>
              <h2 className="font-serif text-xl mb-3">Also on radar</h2>
              <div className="grid md:grid-cols-2 gap-3">
                {b.alsoOnRadar.map((it, i) => <ItemCard key={i} item={it} />)}
              </div>
            </div>
          </div>
        )}
      />
    </div>
  );
}
