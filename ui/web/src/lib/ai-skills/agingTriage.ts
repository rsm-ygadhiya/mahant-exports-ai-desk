import { prisma } from '@/lib/db';
import { askJson } from '@/lib/ai';

export type TriageTag = 'HOLD' | 'WATCH' | 'DISCOUNT' | 'CLEAR';

export type TriageItem = {
  stoneId: string;
  tag: TriageTag;
  reason: string;
  suggestedDiscountPct?: number; // negative numbers = discount off current $/ct
};

export type TriageResult = {
  items: TriageItem[];
  summary: string;
};

const SYSTEM = `You are an inventory aging triage advisor for Mahant Exports, a B2B lab-grown diamond wholesaler.

Your job: review the available stock and tag every stone with one of:
- HOLD     — fresh, in-demand, or specialty stone — keep at current price
- WATCH    — borderline; revisit in 1 week if no movement
- DISCOUNT — moving slowly; suggest a 3–8% price reduction to stimulate demand
- CLEAR    — stale or off-spec; suggest a 10–20% reduction to clear inventory

Anchor your judgment on:
- Age in stock (older = more aggressive)
- Category velocity (Round + smaller = faster; Fancy + large = slower)
- Demand signals (recent enquiries on similar specs)
- Discount % already applied (already-discounted = closer to CLEAR)
- Price band (lower-ticket can move faster on small discounts)

Be concise and decisive. Reasons should be one short sentence.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', description: 'One paragraph overall assessment of inventory health.' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stoneId: { type: 'string' },
          tag: { type: 'string', enum: ['HOLD', 'WATCH', 'DISCOUNT', 'CLEAR'] },
          reason: { type: 'string' },
          suggestedDiscountPct: { type: ['number', 'null'] },
        },
        required: ['stoneId', 'tag', 'reason', 'suggestedDiscountPct'],
      },
    },
  },
  required: ['summary', 'items'],
};

export async function runAgingTriage(): Promise<TriageResult & { usage: any }> {
  // Pull available stock, capped to keep prompt size reasonable.
  // We sort oldest-first so the riskiest inventory is always inspected.
  const stones = await prisma.diamond.findMany({
    where: { status: 'AVAILABLE' },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });

  // Recent enquiries provide demand signal — fold in last 30 days.
  const since = new Date(Date.now() - 30 * 86_400_000);
  const recentEnquiryItems = await prisma.enquiryItem.findMany({
    where: { enquiry: { createdAt: { gte: since } } },
    include: { diamond: true },
    take: 200,
  });

  const now = Date.now();
  const stoneRows = stones.map(s => {
    const ageDays = Math.floor((now - s.createdAt.getTime()) / 86_400_000);
    return [
      s.stoneId,
      s.shape,
      Number(s.carat).toFixed(2) + 'ct',
      s.color,
      s.clarity,
      s.cut ?? '-',
      s.lab ?? '-',
      `$${Number(s.pricePerCarat).toFixed(0)}/ct`,
      `$${Number(s.totalPrice).toFixed(0)}`,
      s.discountPct != null ? `disc ${Number(s.discountPct).toFixed(1)}%` : '-',
      `${ageDays}d old`,
    ].join(' · ');
  });

  const enquiredCounts = new Map<string, number>();
  for (const it of recentEnquiryItems) {
    const key = `${it.diamond.shape}-${it.diamond.color}-${it.diamond.clarity}`;
    enquiredCounts.set(key, (enquiredCounts.get(key) ?? 0) + 1);
  }
  const demandSignals = Array.from(enquiredCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([k, n]) => `${k}: ${n} enquiries`).join('\n');

  const cachedContext = `=== AVAILABLE STOCK (${stones.length} stones, oldest first) ===
${stoneRows.join('\n')}

=== RECENT DEMAND SIGNALS (last 30 days, top categories by enquiry count) ===
${demandSignals || '(no enquiries in last 30 days)'}`;

  const userMessage = `Triage every stone above. For each, return: stoneId, tag (HOLD/WATCH/DISCOUNT/CLEAR), one-sentence reason, and suggestedDiscountPct (a negative number representing % off current $/ct, or null if no change).

Be decisive — don't tag everything WATCH. Aim for a realistic mix: most stones HOLD or WATCH, a handful DISCOUNT, the worst few CLEAR.

Then give a short summary paragraph of overall inventory health and what you'd do this week.`;

  const { data, usage } = await askJson<TriageResult>({
    system: SYSTEM,
    cachedContext,
    userMessage,
    schema: SCHEMA,
  });

  return { ...data, usage };
}
