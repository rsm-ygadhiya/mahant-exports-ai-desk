import { prisma } from '@/lib/db';
import { askJson } from '@/lib/ai';

export type BriefingItem = {
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  action: string;
  context: string;
  /** Page the whole card opens when clicked. */
  href?: string | null;
  /** Specific rows the desk should look at — each is its own clickable link. */
  details?: { label: string; href: string }[];
};

export type BriefingResult = {
  greeting: string;
  topPriorities: BriefingItem[];
  alsoOnRadar: BriefingItem[];
  summary: string;
};

const SYSTEM = `You are the desk briefer for Mahant Exports, a B2B lab-grown diamond wholesaler.
Each morning, you give the owner a prioritized to-do list pulled from inventory, enquiries, and customer state.

Voice: direct, concise, business-first. Skip pleasantries beyond a one-line greeting.

When prioritizing:
- HIGH: revenue at risk (stale memos), buyers waiting (new enquiries), pending signups (lost leads if ignored)
- MEDIUM: inventory health (aging stock, sourcing gaps), follow-ups
- LOW: nice-to-haves, backlog cleanup

Each item MUST include:
- "href": the page the card opens. Pick from this set ONLY:
    /admin/enquiries · /admin/memo · /admin/customers · /admin/ai/aging · /admin/sold · /admin/diamonds · /admin/pricing
  Use null only for items with no concrete page.
- "details": up to 3 specific rows the desk should click into, each with a deep link
  using the IDs you'll see in the context block — e.g.
    /admin/enquiries/{enquiryId}   /admin/diamonds/{diamondId}   /admin/customers/{customerId}
  Leave empty if the item is generic (e.g. "review weekly conversion").`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    greeting: { type: 'string', description: 'One-line opener appropriate to the day.' },
    topPriorities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          priority: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
          category: { type: 'string', description: 'Short category like "Enquiry", "Aging memo", "Customer approval".' },
          action: { type: 'string', description: 'What to do, in one imperative sentence.' },
          context: { type: 'string', description: 'Why this matters / relevant numbers.' },
          href: { type: ['string', 'null'], description: 'Page that opens when the card is clicked, e.g. /admin/enquiries, /admin/memo, /admin/customers, /admin/ai/aging, /admin/sold.' },
          details: {
            type: 'array',
            description: 'Up to 3 specific rows to click — deep links into /admin/enquiries/{id}, /admin/diamonds/{id}, /admin/customers/{id}.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { label: { type: 'string' }, href: { type: 'string' } },
              required: ['label', 'href'],
            },
          },
        },
        required: ['priority', 'category', 'action', 'context', 'href', 'details'],
      },
    },
    alsoOnRadar: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          priority: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
          category: { type: 'string' },
          action: { type: 'string' },
          context: { type: 'string' },
        },
        required: ['priority', 'category', 'action', 'context'],
      },
    },
    summary: { type: 'string', description: 'One-paragraph theme for the day.' },
  },
  required: ['greeting', 'topPriorities', 'alsoOnRadar', 'summary'],
};

export async function runMorningBriefing(): Promise<BriefingResult & { usage: any }> {
  const now = Date.now();

  const [
    available, hold, sold, pendingCustomers, totalCustomers,
    newEnquiries, allEnquiries, staleMemos, recentEnquiries,
  ] = await Promise.all([
    prisma.diamond.count({ where: { status: 'AVAILABLE' } }),
    prisma.diamond.count({ where: { status: 'HOLD' } }),
    prisma.diamond.count({ where: { status: 'SOLD' } }),
    prisma.customer.count({ where: { status: 'PENDING' } }),
    prisma.customer.count(),
    prisma.enquiry.count({ where: { status: 'NEW' } }),
    prisma.enquiry.count(),
    prisma.diamond.findMany({
      where: { status: 'HOLD', updatedAt: { lt: new Date(now - 7 * 86_400_000) } },
      orderBy: { updatedAt: 'asc' },
      take: 20,
    }),
    prisma.enquiry.findMany({
      where: { status: 'NEW' },
      include: { customer: true, items: { include: { diamond: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);

  const valueAvail = await prisma.diamond.aggregate({ where: { status: 'AVAILABLE' }, _sum: { totalPrice: true } });

  const staleLines = staleMemos.map(d => {
    const days = Math.floor((now - d.updatedAt.getTime()) / 86_400_000);
    return `[id=${d.id}] ${d.stoneId} (${d.shape} ${Number(d.carat).toFixed(2)}ct ${d.color}/${d.clarity}, $${Number(d.totalPrice).toFixed(0)}) — on memo ${days} days`;
  });

  const enqLines = recentEnquiries.map(eq => {
    const total = eq.items.reduce((s, it) => s + Number(it.totalPrice ?? 0), 0);
    const days = Math.floor((now - eq.createdAt.getTime()) / 86_400_000);
    return `[id=${eq.id}] ${eq.customer.companyName} (${eq.items.length} stones, ~$${Math.round(total)}) — ${days}d ago, status ${eq.status}`;
  });

  const cachedContext = `=== TODAY'S DESK STATE ===
Stock:    ${available.toLocaleString()} available · ${hold} on memo · ${sold} sold
Avail. value: $${Number(valueAvail._sum.totalPrice ?? 0).toLocaleString()}
Customers:    ${totalCustomers} total · ${pendingCustomers} pending approval
Enquiries:    ${newEnquiries} new (unactioned) · ${allEnquiries} all-time

=== STALE MEMOS (>7 days, oldest first) ===
${staleLines.join('\n') || '(none)'}

=== RECENT ENQUIRIES (newest first, all NEW status) ===
${enqLines.join('\n') || '(none)'}`;

  const userMessage = `Give me my morning briefing. Identify 3-5 top priorities (HIGH-priority items that need action today) and 3-5 items also on the radar. Then a one-paragraph theme summary.`;

  const { data, usage } = await askJson<BriefingResult>({
    system: SYSTEM,
    cachedContext,
    userMessage,
    schema: SCHEMA,
  });
  return { ...data, usage };
}
