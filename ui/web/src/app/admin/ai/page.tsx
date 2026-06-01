import Link from 'next/link';

const SKILLS = [
  {
    href: '/admin/ai/briefing',
    icon: '🌅',
    title: 'Morning Briefing',
    desc: 'Prioritized to-do list pulling stock, enquiries, and customers into one view.',
  },
  {
    href: '/admin/ai/aging',
    icon: '⏳',
    title: 'Inventory Aging Triage',
    desc: 'Tag every available stone HOLD / WATCH / DISCOUNT / CLEAR with suggested action.',
  },
  {
    href: '/admin/pricing',
    icon: '💎',
    title: 'Weekly Repricing',
    desc: 'Upload Rap rates, generate rule-based proposals, review per-stone, push to inventory.',
  },
  {
    href: '/admin/ai/demand',
    icon: '📈',
    title: 'Demand Forecast',
    desc: 'Find sourcing gaps and surpluses by comparing inventory to recent enquiries.',
  },
  {
    href: '/admin/ai/quote',
    icon: '🤝',
    title: 'Quote Negotiation',
    desc: 'For every open enquiry: ACCEPT / COUNTER / HOLD / WALK_AWAY + drafted reply.',
  },
  {
    href: '/admin/ai/memo',
    icon: '📝',
    title: 'Memo Approval',
    desc: 'Review every stone on memo: approve / approve-with-conditions / reject.',
  },
  {
    href: '/admin/ai/clv',
    icon: '👑',
    title: 'CLV Analysis',
    desc: 'Estimate customer lifetime value. Identify top accounts and at-risk relationships.',
  },
  {
    href: '/admin/ai/threads',
    icon: '🧵',
    title: 'Negotiation Threads',
    desc: 'Summarize every enquiry thread + recommend next action.',
  },
  {
    href: '/admin/ai/collections',
    icon: '💰',
    title: 'Collection Reminders',
    desc: 'Bucket overdue payments by age, draft tone-appropriate reminder messages.',
  },
];

export default function AiIndex() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">Decision Tools</h1>
        <p className="text-sm text-brand-700 mt-1">
          Skills tailored to lab-grown diamond wholesaling. Each one reads your live
          inventory, customer, and enquiry data and returns a structured recommendation.
        </p>
        <p className="text-sm text-brand-700 mt-1">
          Most tools run as <span className="font-mono text-xs">⚡ rule-based</span> Python automations —
          instant, deterministic, no API key. Three tools that produce free-text output
          (Quote replies, Collection reminders, Thread summaries) also offer an opt-in
          <span className="font-mono text-xs"> ✨ AI</span> mode for nuanced wording.
        </p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {SKILLS.map(s => (
          <Link key={s.href} href={s.href} className="card p-5 hover:shadow-md transition group">
            <div className="text-3xl mb-2">{s.icon}</div>
            <div className="font-serif text-lg group-hover:text-gold-600 transition">{s.title}</div>
            <p className="text-sm text-brand-700 mt-1">{s.desc}</p>
          </Link>
        ))}
      </div>

      <div className="card p-4 bg-brand-50/40 text-xs text-brand-700">
        <b>Heads-up:</b> the three tools with the ✨ AI option call OpenAI and use tokens. Set <span className="font-mono">OPENAI_API_KEY</span> in <span className="font-mono">.env</span> to enable. Costs ~$0.05–$0.30 per analysis on GPT-4o (~25× less on GPT-4o-mini via <span className="font-mono">OPENAI_MODEL=gpt-4o-mini</span>). All other tools run locally with no API calls.
      </div>
    </div>
  );
}
