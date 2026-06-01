import { prisma } from '@/lib/db';
import { askJson } from '@/lib/ai';

export type Bucket = 'JUST_DUE' | 'AGING' | 'OVERDUE' | 'CRITICAL';

export type Reminder = {
  customerName: string;
  stoneId: string;
  amount: number;
  daysSinceSold: number;
  bucket: Bucket;
  draftMessage: string;
  tone: 'FRIENDLY' | 'FIRM' | 'ESCALATED';
};

export type CollectionResult = {
  reminders: Reminder[];
  summary: string;
};

const SYSTEM = `You are the collections desk for Mahant Exports, a B2B lab-grown diamond wholesaler.

NOTE: This deployment doesn't yet have a formal invoice/payment ledger. We approximate by treating SOLD stones as deals where payment may still be in transit. Use the days-since-sold as a proxy for days-past-due (assume Net 30 terms).

Buckets (using days-since-sold as proxy for days-past-due):
- JUST_DUE: 30-45 days — friendly nudge
- AGING: 45-60 days — firmer follow-up
- OVERDUE: 60-90 days — escalated
- CRITICAL: 90+ days — manager-level intervention

Draft messages should:
- Be short and professional
- Reference the specific stone (cert no + spec)
- Include amount and approximate days-past-due
- Match the tone bucket — never overly aggressive

In production, replace this with a real invoice/payment system.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    reminders: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          customerName: { type: 'string' },
          stoneId: { type: 'string' },
          amount: { type: 'number' },
          daysSinceSold: { type: 'number' },
          bucket: { type: 'string', enum: ['JUST_DUE', 'AGING', 'OVERDUE', 'CRITICAL'] },
          draftMessage: { type: 'string' },
          tone: { type: 'string', enum: ['FRIENDLY', 'FIRM', 'ESCALATED'] },
        },
        required: ['customerName', 'stoneId', 'amount', 'daysSinceSold', 'bucket', 'draftMessage', 'tone'],
      },
    },
  },
  required: ['summary', 'reminders'],
};

export async function runCollectionReminders(): Promise<CollectionResult & { usage: any }> {
  const cutoff = new Date(Date.now() - 30 * 86_400_000); // only stones sold ≥30 days ago
  const sold = await prisma.diamond.findMany({
    where: { status: 'SOLD', updatedAt: { lt: cutoff } },
    orderBy: { updatedAt: 'asc' },
    take: 50,
  });

  const enqItems = await prisma.enquiryItem.findMany({
    where: { diamondId: { in: sold.map(s => s.id) } },
    include: { enquiry: { include: { customer: true } } },
    orderBy: { enquiry: { createdAt: 'desc' } },
  });
  const stoneToCustomer = new Map<string, string>();
  for (const it of enqItems) {
    if (!stoneToCustomer.has(it.diamondId)) {
      stoneToCustomer.set(it.diamondId, it.enquiry.customer.companyName);
    }
  }

  const now = Date.now();
  const lines = sold.map(d => {
    const days = Math.floor((now - d.updatedAt.getTime()) / 86_400_000);
    const cust = stoneToCustomer.get(d.id) ?? 'Unknown buyer';
    return `${d.stoneId}: ${cust} | ${d.shape} ${Number(d.carat).toFixed(2)}ct ${d.color}/${d.clarity} ${d.lab ?? ''} ${d.certificateNo ?? ''} | $${Number(d.totalPrice).toFixed(0)} | sold ${days}d ago`;
  });

  const cachedContext = `=== SOLD STONES, oldest first (proxy for outstanding payments) ===
${lines.join('\n') || '(no sales older than 30 days)'}`;

  const userMessage = `Generate collection reminders. Bucket each, draft a tone-appropriate message, and summarize the aging picture.`;

  const { data, usage } = await askJson<CollectionResult>({
    system: SYSTEM,
    cachedContext,
    userMessage,
    schema: SCHEMA,
  });
  return { ...data, usage };
}
