import { prisma } from '@/lib/db';
import { askJson } from '@/lib/ai';

export type RepriceItem = {
  stoneId: string;
  oldPpc: number;
  newPpc: number;
  changePct: number;
  reason: string;
};

export type RepricingResult = {
  items: RepriceItem[];
  summary: string;
};

const SYSTEM = `You are the weekly repricing engine for Mahant Exports, a B2B lab-grown diamond wholesaler.
You recompute the price-per-carat for every available stone using these factors (in order of importance):

1. **Aging in stock** — older stones get progressive discounts (3-5% at 30d, 8-12% at 60d, 15-20% at 90d+)
2. **Category velocity** — Round + 1-2ct + VS-VVS clarities turn fast (small reduction); Fancy shapes + 3ct+ + SI clarities turn slow (deeper)
3. **Demand signal** — categories with recent enquiries can hold price; categories with zero recent enquiries should drop more
4. **Existing discount %** — already-discounted stones move further down the curve
5. **Margin floor** — never reduce more than 25% off current $/ct in a single repricing pass
6. **Round increments** — keep $/ct round (multiples of $5 or $10)

Output the recommended new $/ct for every stone, even if unchanged.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', description: 'How many stones changed, average %, and overall pricing posture for the week.' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stoneId: { type: 'string' },
          oldPpc: { type: 'number' },
          newPpc: { type: 'number' },
          changePct: { type: 'number', description: 'Negative = discount, positive = increase, 0 = unchanged.' },
          reason: { type: 'string' },
        },
        required: ['stoneId', 'oldPpc', 'newPpc', 'changePct', 'reason'],
      },
    },
  },
  required: ['summary', 'items'],
};

export async function runWeeklyRepricing(): Promise<RepricingResult & { usage: any }> {
  const stones = await prisma.diamond.findMany({
    where: { status: 'AVAILABLE' },
    orderBy: { createdAt: 'asc' },
    take: 150,
  });

  const since = new Date(Date.now() - 30 * 86_400_000);
  const enqItems = await prisma.enquiryItem.findMany({
    where: { enquiry: { createdAt: { gte: since } } },
    include: { diamond: { select: { shape: true, color: true, clarity: true } } },
  });

  const demandKeys = new Map<string, number>();
  for (const it of enqItems) {
    const k = `${it.diamond.shape}/${it.diamond.color}/${it.diamond.clarity}`;
    demandKeys.set(k, (demandKeys.get(k) ?? 0) + 1);
  }

  const now = Date.now();
  const stoneRows = stones.map(s => {
    const ageDays = Math.floor((now - s.createdAt.getTime()) / 86_400_000);
    const dKey = `${s.shape}/${s.color}/${s.clarity}`;
    return [
      s.stoneId,
      s.shape,
      Number(s.carat).toFixed(2) + 'ct',
      s.color,
      s.clarity,
      `$${Number(s.pricePerCarat).toFixed(0)}/ct`,
      s.discountPct != null ? `disc ${Number(s.discountPct).toFixed(1)}%` : '-',
      `${ageDays}d old`,
      `dem=${demandKeys.get(dKey) ?? 0}`,
    ].join(' · ');
  });

  const cachedContext = `=== AVAILABLE STOCK (oldest first) ===
${stoneRows.join('\n')}`;

  const userMessage = `Reprice every stone above. For each, return stoneId, oldPpc (current), newPpc (recommended), changePct, and a one-sentence reason.

Be deliberate — most stones should change only slightly or not at all. Reserve bigger drops for stale, low-demand inventory.

Then summarize: how many stones changed, average % move, and the overall posture for the week (aggressive / moderate / hold steady).`;

  const { data, usage } = await askJson<RepricingResult>({
    system: SYSTEM,
    cachedContext,
    userMessage,
    schema: SCHEMA,
  });
  return { ...data, usage };
}

/**
 * Apply a repricing result to the DB. Returns count updated.
 * Updates discountPct correspondingly so the totalPrice stays consistent.
 */
export async function applyRepricing(result: RepricingResult): Promise<number> {
  let n = 0;
  for (const it of result.items) {
    if (it.newPpc === it.oldPpc) continue;
    const stone = await prisma.diamond.findUnique({ where: { stoneId: it.stoneId } });
    if (!stone) continue;
    const newTotal = it.newPpc * Number(stone.carat);
    await prisma.diamond.update({
      where: { stoneId: it.stoneId },
      data: {
        pricePerCarat: it.newPpc as any,
        totalPrice: newTotal as any,
        discountPct: it.changePct as any,
      },
    });
    n++;
  }
  return n;
}
