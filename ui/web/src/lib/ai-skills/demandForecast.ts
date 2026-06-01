import { prisma } from '@/lib/db';
import { askJson } from '@/lib/ai';

export type GapItem = {
  category: string; // e.g. "Round 1.0-1.5ct VS1 D-F"
  severity: 'CRITICAL' | 'NOTABLE' | 'MINOR';
  reason: string;
  recommendation: string;
};

export type ForecastResult = {
  gaps: GapItem[];
  surpluses: GapItem[];
  summary: string;
};

const SYSTEM = `You are a sourcing advisor for Mahant Exports, a B2B lab-grown diamond wholesaler.
You compare current available inventory against recent enquiry signals to identify:
- GAPS — categories with strong demand but thin/no available stock → recommend sourcing
- SURPLUSES — categories with heavy stock but weak demand → recommend slowing buys / clearing

Be specific in category descriptions: shape + carat band + clarity + color band.
Severity:
- CRITICAL: zero or near-zero stock with multiple recent enquiries
- NOTABLE: thin stock relative to enquiry volume
- MINOR: small imbalance, worth monitoring`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          category: { type: 'string' },
          severity: { type: 'string', enum: ['CRITICAL', 'NOTABLE', 'MINOR'] },
          reason: { type: 'string' },
          recommendation: { type: 'string' },
        },
        required: ['category', 'severity', 'reason', 'recommendation'],
      },
    },
    surpluses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          category: { type: 'string' },
          severity: { type: 'string', enum: ['CRITICAL', 'NOTABLE', 'MINOR'] },
          reason: { type: 'string' },
          recommendation: { type: 'string' },
        },
        required: ['category', 'severity', 'reason', 'recommendation'],
      },
    },
  },
  required: ['summary', 'gaps', 'surpluses'],
};

function caratBand(c: number): string {
  if (c < 0.5) return '<0.5ct';
  if (c < 1.0) return '0.5-1.0ct';
  if (c < 1.5) return '1.0-1.5ct';
  if (c < 2.0) return '1.5-2.0ct';
  if (c < 3.0) return '2.0-3.0ct';
  return '3.0ct+';
}

export async function runDemandForecast(): Promise<ForecastResult & { usage: any }> {
  // Group available stock by shape × caratBand × clarity.
  const stones = await prisma.diamond.findMany({
    where: { status: 'AVAILABLE' },
    select: { shape: true, carat: true, color: true, clarity: true, pricePerCarat: true },
  });

  // Last 60 days of enquiry items.
  const since = new Date(Date.now() - 60 * 86_400_000);
  const enqItems = await prisma.enquiryItem.findMany({
    where: { enquiry: { createdAt: { gte: since } } },
    include: { diamond: { select: { shape: true, carat: true, color: true, clarity: true } } },
  });

  function key(shape: string, carat: number, clarity: string) {
    return `${shape} · ${caratBand(carat)} · ${clarity}`;
  }

  const supply = new Map<string, number>();
  const supplyAvgPpc = new Map<string, number[]>();
  for (const s of stones) {
    const k = key(s.shape, Number(s.carat), s.clarity);
    supply.set(k, (supply.get(k) ?? 0) + 1);
    if (!supplyAvgPpc.has(k)) supplyAvgPpc.set(k, []);
    supplyAvgPpc.get(k)!.push(Number(s.pricePerCarat));
  }

  const demand = new Map<string, number>();
  for (const it of enqItems) {
    const d = it.diamond;
    const k = key(d.shape, Number(d.carat), d.clarity);
    demand.set(k, (demand.get(k) ?? 0) + 1);
  }

  // Build a tabular context: every category seen in either side.
  const allKeys = new Set<string>([...supply.keys(), ...demand.keys()]);
  const rows: string[] = [];
  for (const k of allKeys) {
    const sup = supply.get(k) ?? 0;
    const dem = demand.get(k) ?? 0;
    const ppcArr = supplyAvgPpc.get(k);
    const avgPpc = ppcArr?.length ? ppcArr.reduce((a, b) => a + b, 0) / ppcArr.length : null;
    rows.push(`${k} | supply=${sup} | demand=${dem} | avgPpc=${avgPpc ? '$' + Math.round(avgPpc) : '-'}`);
  }

  // Sort by demand:supply ratio so the most stretched categories come first.
  rows.sort((a, b) => {
    const dem = (s: string) => Number(s.match(/demand=(\d+)/)?.[1] ?? 0);
    const sup = (s: string) => Number(s.match(/supply=(\d+)/)?.[1] ?? 0);
    return (dem(b) / Math.max(1, sup(b))) - (dem(a) / Math.max(1, sup(a)));
  });

  const cachedContext = `=== SUPPLY vs DEMAND (last 60 days of enquiries) ===
${rows.slice(0, 60).join('\n')}`;

  const userMessage = `Identify 4-7 sourcing GAPS and 2-4 SURPLUSES. Return them with severity, reason, and a concrete recommendation. Then summary paragraph.`;

  const { data, usage } = await askJson<ForecastResult>({
    system: SYSTEM,
    cachedContext,
    userMessage,
    schema: SCHEMA,
  });
  return { ...data, usage };
}
