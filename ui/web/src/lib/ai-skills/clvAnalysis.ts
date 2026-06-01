import { prisma } from '@/lib/db';
import { askJson } from '@/lib/ai';

export type CustomerCLV = {
  customerId: string;
  companyName: string;
  estimatedCLV: number;
  enquiryCount: number;
  conversionEstimate: string; // e.g. "30%" — model-judged from enquiry quality
  // Canonical CLV quartile, shared with the CLV skill + autopilot.
  tier: 'Top' | 'High' | 'Mid' | 'Low';
  recommendation: string;
};

export type CLVResult = {
  topCustomers: CustomerCLV[];
  atRisk: CustomerCLV[];
  summary: string;
};

const SYSTEM = `You are a customer lifetime value (CLV) analyst for Mahant Exports, a B2B lab-grown diamond wholesaler.

You estimate each customer's lifetime value from their enquiry behavior:
- Frequency, recency, and total value of enquiries
- Pricing tier (HIDDEN tier = bespoke high-value, often platinum)
- Approval status + signup date

CLV is a directional estimate — you're not given actual purchase history, so use enquiry value × an estimated conversion rate × an estimated repeat factor.

Tiers — CLV quartiles (the canonical project-wide bucketing):
- Top: top 25% — protect, give white-glove treatment
- High: next 25% — proactive sourcing, faster response
- Mid: next 25% — standard service
- Low: bottom 25% — keep on list, low touch

Recommendations are concrete (e.g. "send the new 2ct VS lot directly", "follow up on stale enquiry from last week").`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    topCustomers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          customerId: { type: 'string' },
          companyName: { type: 'string' },
          estimatedCLV: { type: 'number' },
          enquiryCount: { type: 'number' },
          conversionEstimate: { type: 'string' },
          tier: { type: 'string', enum: ['Top', 'High', 'Mid', 'Low'] },
          recommendation: { type: 'string' },
        },
        required: ['customerId', 'companyName', 'estimatedCLV', 'enquiryCount', 'conversionEstimate', 'tier', 'recommendation'],
      },
    },
    atRisk: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          customerId: { type: 'string' },
          companyName: { type: 'string' },
          estimatedCLV: { type: 'number' },
          enquiryCount: { type: 'number' },
          conversionEstimate: { type: 'string' },
          tier: { type: 'string', enum: ['Top', 'High', 'Mid', 'Low'] },
          recommendation: { type: 'string' },
        },
        required: ['customerId', 'companyName', 'estimatedCLV', 'enquiryCount', 'conversionEstimate', 'tier', 'recommendation'],
      },
    },
  },
  required: ['summary', 'topCustomers', 'atRisk'],
};

export async function runCLVAnalysis(): Promise<CLVResult & { usage: any }> {
  const customers = await prisma.customer.findMany({
    where: { status: 'APPROVED' },
    include: {
      pricingRule: true,
      enquiries: { include: { items: true } },
    },
    take: 100,
  });

  const now = Date.now();
  const rows = customers.map(c => {
    const totalValue = c.enquiries.reduce((s, eq) => {
      return s + eq.items.reduce((s2, it) => s2 + Number(it.totalPrice ?? 0), 0);
    }, 0);
    const lastEnq = c.enquiries[0]?.createdAt;
    const daysSince = lastEnq ? Math.floor((now - lastEnq.getTime()) / 86_400_000) : null;
    const tier = c.pricingRule?.mode ?? 'BASE';
    const adj = c.pricingRule?.adjustPct;
    return `${c.id} | ${c.companyName} (${c.country ?? '-'}) | tier=${tier}${adj != null ? ` (${adj}%)` : ''} | ${c.enquiries.length} enquiries, total ~$${Math.round(totalValue).toLocaleString()} | last activity: ${daysSince != null ? `${daysSince}d ago` : 'none'}`;
  });

  const cachedContext = `=== APPROVED CUSTOMERS (active and inactive) ===
${rows.join('\n')}`;

  const userMessage = `Estimate CLV for each customer. Return:
- topCustomers: 5-10 highest-CLV customers (Top/High)
- atRisk: 3-7 high-CLV customers who've gone quiet (no recent activity) — ones worth re-engaging
- summary: overall portfolio health and top 1-2 strategic moves`;

  const { data, usage } = await askJson<CLVResult>({
    system: SYSTEM,
    cachedContext,
    userMessage,
    schema: SCHEMA,
  });
  return { ...data, usage };
}
