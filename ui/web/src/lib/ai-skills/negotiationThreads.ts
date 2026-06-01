import { prisma } from '@/lib/db';
import { askJson } from '@/lib/ai';

export type ThreadSummary = {
  enquiryId: string;
  customerName: string;
  status: 'OPEN' | 'STALLED' | 'WARM' | 'CLOSED_WON' | 'CLOSED_LOST';
  daysSinceLastTouch: number;
  oneLineSummary: string;
  nextAction: string;
};

export type ThreadsResult = {
  threads: ThreadSummary[];
  summary: string;
};

const SYSTEM = `You are the negotiation thread summarizer for Mahant Exports, a B2B lab-grown diamond wholesaler.

For each enquiry thread, produce:
- Current status (OPEN / STALLED / WARM / CLOSED_WON / CLOSED_LOST)
- One-line summary of what the customer wants and where things stand
- Concrete next action

NOTE: This deployment doesn't have a full multi-turn comm log yet. We work from:
- Enquiry creation date and current status (NEW/CONTACTED/CLOSED)
- The buyer's note attached at enquiry time
- Stones requested and customer pricing tier

A "stalled" thread is one that's been NEW for >5 days or CONTACTED for >3 days with no movement.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    threads: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          enquiryId: { type: 'string' },
          customerName: { type: 'string' },
          status: { type: 'string', enum: ['OPEN', 'STALLED', 'WARM', 'CLOSED_WON', 'CLOSED_LOST'] },
          daysSinceLastTouch: { type: 'number' },
          oneLineSummary: { type: 'string' },
          nextAction: { type: 'string' },
        },
        required: ['enquiryId', 'customerName', 'status', 'daysSinceLastTouch', 'oneLineSummary', 'nextAction'],
      },
    },
  },
  required: ['summary', 'threads'],
};

export async function runNegotiationThreads(): Promise<ThreadsResult & { usage: any }> {
  const enquiries = await prisma.enquiry.findMany({
    include: {
      customer: { include: { pricingRule: true } },
      items: { include: { diamond: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const now = Date.now();
  const lines = enquiries.map(eq => {
    const days = Math.floor((now - eq.createdAt.getTime()) / 86_400_000);
    const items = eq.items.map(it => `${it.diamond.shape} ${Number(it.diamond.carat).toFixed(2)}ct ${it.diamond.color}/${it.diamond.clarity}`).join(', ');
    const total = eq.items.reduce((s, it) => s + Number(it.totalPrice ?? 0), 0);
    const tier = eq.customer.pricingRule?.mode ?? 'BASE';
    const note = eq.message ? ` | note: "${eq.message}"` : '';
    return `${eq.id} | ${eq.customer.companyName} (tier=${tier}) | ${days}d old | ${eq.status} | ${eq.items.length} stones (${items}) ~$${Math.round(total)}${note}`;
  });

  const cachedContext = `=== ENQUIRY THREADS ===
${lines.join('\n')}`;

  const userMessage = `For every thread above, produce status + one-line summary + next action. Then a one-paragraph health summary of the negotiation pipeline overall.`;

  const { data, usage } = await askJson<ThreadsResult>({
    system: SYSTEM,
    cachedContext,
    userMessage,
    schema: SCHEMA,
  });
  return { ...data, usage };
}
