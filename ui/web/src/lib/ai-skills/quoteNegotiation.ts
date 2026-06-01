import { prisma } from '@/lib/db';
import { askJson } from '@/lib/ai';

export type Decision = 'ACCEPT' | 'COUNTER' | 'HOLD' | 'WALK_AWAY' | 'ESCALATE';

export type NegotiationResponse = {
  enquiryId: string;
  customerName: string;
  decision: Decision;
  counterPpc?: number;
  reasoning: string;
  draftReply: string;
};

const SYSTEM = `You are a negotiation advisor for Mahant Exports, a B2B lab-grown diamond wholesaler.

For each open enquiry, decide ACCEPT / COUNTER / HOLD / WALK_AWAY / ESCALATE based on:
- Customer's pricing tier (BASE / ADJUST_PCT / HIDDEN)
- The stones requested vs current $/ct
- Stone aging (older → more flex)
- Current discount % already on the stone
- Margin floor (don't go below your cost basis — assume current $/ct is ~85-90% of cost-recoverable)

Decisions:
- ACCEPT: customer's offer is at or above your floor — close the deal
- COUNTER: there's room to come down — propose a specific $/ct
- HOLD: stone is fresh/in-demand, don't move on price; offer alternatives
- WALK_AWAY: ask is too aggressive, no path
- ESCALATE: complex multi-stone, special customer, or strategic — owner decides

Draft replies are short, professional, and direct. No long pleasantries.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    responses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          enquiryId: { type: 'string' },
          customerName: { type: 'string' },
          decision: { type: 'string', enum: ['ACCEPT', 'COUNTER', 'HOLD', 'WALK_AWAY', 'ESCALATE'] },
          counterPpc: { type: ['number', 'null'] },
          reasoning: { type: 'string' },
          draftReply: { type: 'string' },
        },
        required: ['enquiryId', 'customerName', 'decision', 'counterPpc', 'reasoning', 'draftReply'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['responses', 'summary'],
};

export async function runQuoteNegotiation(): Promise<{ responses: NegotiationResponse[]; summary: string; usage: any }> {
  const enquiries = await prisma.enquiry.findMany({
    where: { status: { in: ['NEW', 'CONTACTED'] } },
    include: {
      customer: { include: { pricingRule: true } },
      items: { include: { diamond: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  const now = Date.now();
  const lines = enquiries.map(eq => {
    const tier = eq.customer.pricingRule?.mode ?? 'BASE';
    const adjust = eq.customer.pricingRule?.adjustPct;
    const items = eq.items.map(it => {
      const ageDays = Math.floor((now - it.diamond.createdAt.getTime()) / 86_400_000);
      return `  - ${it.diamond.stoneId}: ${it.diamond.shape} ${Number(it.diamond.carat).toFixed(2)}ct ${it.diamond.color}/${it.diamond.clarity}, current $${Number(it.diamond.pricePerCarat).toFixed(0)}/ct, age ${ageDays}d, disc ${it.diamond.discountPct ?? 0}%`;
    }).join('\n');
    const msg = eq.message ? `\n  Buyer note: "${eq.message}"` : '';
    return `Enquiry ${eq.id} | ${eq.customer.companyName} | tier=${tier}${adjust != null ? ` (${adjust}%)` : ''} | status=${eq.status}\n${items}${msg}`;
  });

  const cachedContext = `=== OPEN ENQUIRIES (NEW + CONTACTED) ===
${lines.join('\n\n')}`;

  const userMessage = `For every enquiry above, decide the next move and draft a reply. Be deliberate — not every deal needs a counter, and not every counter is worth chasing.`;

  const { data, usage } = await askJson<{ responses: NegotiationResponse[]; summary: string }>({
    system: SYSTEM,
    cachedContext,
    userMessage,
    schema: SCHEMA,
  });
  return { ...data, usage };
}
