// Similar-stone price suggestion for new stock awaiting price approval.
//
// Spec reference: admin_panel_spec.md §5.2.
// For each new stone, find similar stones in existing inventory or sold
// history using shape, color, clarity, carat (±10%), cut, then compute a
// suggested $/ct from the price distribution of comparables.

import { prisma } from '@/lib/db';

export type SuggestionBasis = 'exact' | 'relaxed_cut' | 'relaxed_clarity' | 'shape_color_only' | 'shape_only' | 'no_match';

export type PriceSuggestion = {
  diamondId: string;
  suggestedPpc: number | null;
  basis: SuggestionBasis;
  comparablesUsed: number;
  /** Median, plus a couple of useful stats for the reviewer. */
  stats: { min: number; median: number; mean: number; max: number } | null;
  /** Spec wants "comparable stones found" surfaced — give the IDs of up to 10 for transparency. */
  comparableIds: string[];
};

const CARAT_TOLERANCE = 0.10; // ±10%

// Comparable pool: AVAILABLE + SOLD. NOT_LIVE and HOLD are noisy/transient.
const COMPARABLE_STATUSES: Array<'AVAILABLE' | 'SOLD'> = ['AVAILABLE', 'SOLD'];

type StoneFingerprint = {
  id: string;
  stoneId: string;
  shape: string;
  carat: number;
  color: string;
  clarity: string;
  cut: string | null;
};

function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/**
 * Build a one-shot suggestion. Tries progressively looser match criteria until
 * we have at least 3 comparables (so the median is meaningful).
 */
export async function suggestPriceForStone(stone: StoneFingerprint): Promise<PriceSuggestion> {
  const caratMin = stone.carat * (1 - CARAT_TOLERANCE);
  const caratMax = stone.carat * (1 + CARAT_TOLERANCE);

  // Tier 1 — exact spec match (shape, color, clarity, cut, carat ±10%)
  const tier1 = await prisma.diamond.findMany({
    where: {
      status: { in: COMPARABLE_STATUSES },
      id: { not: stone.id },
      shape: stone.shape,
      color: stone.color,
      clarity: stone.clarity,
      ...(stone.cut ? { cut: stone.cut } : {}),
      carat: { gte: caratMin as any, lte: caratMax as any },
    },
    select: { id: true, stoneId: true, pricePerCarat: true },
    take: 50,
  });
  if (tier1.length >= 3) return summarise(stone.id, tier1, 'exact');

  // Tier 2 — drop the cut constraint
  const tier2 = await prisma.diamond.findMany({
    where: {
      status: { in: COMPARABLE_STATUSES },
      id: { not: stone.id },
      shape: stone.shape,
      color: stone.color,
      clarity: stone.clarity,
      carat: { gte: caratMin as any, lte: caratMax as any },
    },
    select: { id: true, stoneId: true, pricePerCarat: true },
    take: 50,
  });
  if (tier2.length >= 3) return summarise(stone.id, tier2, 'relaxed_cut');

  // Tier 3 — also drop the clarity constraint (keep shape, color, carat band)
  const tier3 = await prisma.diamond.findMany({
    where: {
      status: { in: COMPARABLE_STATUSES },
      id: { not: stone.id },
      shape: stone.shape,
      color: stone.color,
      carat: { gte: caratMin as any, lte: caratMax as any },
    },
    select: { id: true, stoneId: true, pricePerCarat: true },
    take: 50,
  });
  if (tier3.length >= 3) return summarise(stone.id, tier3, 'relaxed_clarity');

  // Tier 4 — shape + color only, any carat
  const tier4 = await prisma.diamond.findMany({
    where: {
      status: { in: COMPARABLE_STATUSES },
      id: { not: stone.id },
      shape: stone.shape,
      color: stone.color,
    },
    select: { id: true, stoneId: true, pricePerCarat: true },
    take: 50,
  });
  if (tier4.length >= 3) return summarise(stone.id, tier4, 'shape_color_only');

  // Tier 5 — shape only
  const tier5 = await prisma.diamond.findMany({
    where: { status: { in: COMPARABLE_STATUSES }, id: { not: stone.id }, shape: stone.shape },
    select: { id: true, stoneId: true, pricePerCarat: true },
    take: 50,
  });
  if (tier5.length >= 1) return summarise(stone.id, tier5, 'shape_only');

  return {
    diamondId: stone.id,
    suggestedPpc: null,
    basis: 'no_match',
    comparablesUsed: 0,
    stats: null,
    comparableIds: [],
  };
}

function summarise(
  diamondId: string,
  comparables: Array<{ id: string; stoneId: string; pricePerCarat: any }>,
  basis: SuggestionBasis,
): PriceSuggestion {
  const prices = comparables.map(c => Number(c.pricePerCarat)).filter(n => n > 0);
  if (prices.length === 0) {
    return { diamondId, suggestedPpc: null, basis: 'no_match', comparablesUsed: 0, stats: null, comparableIds: [] };
  }
  const med = median(prices);
  return {
    diamondId,
    suggestedPpc: Math.round(med / 5) * 5,           // round to nearest $5
    basis,
    comparablesUsed: prices.length,
    stats: {
      min: Math.round(Math.min(...prices)),
      median: Math.round(med),
      mean: Math.round(mean(prices)),
      max: Math.round(Math.max(...prices)),
    },
    comparableIds: comparables.slice(0, 10).map(c => c.stoneId),
  };
}

/**
 * Batch-build suggestions for many stones at once. Each runs independently
 * (could parallelise; kept sequential here to be gentle on Neon).
 */
export async function suggestPricesForMany(stones: StoneFingerprint[]): Promise<PriceSuggestion[]> {
  const out: PriceSuggestion[] = [];
  for (const s of stones) out.push(await suggestPriceForStone(s));
  return out;
}

export function basisLabel(b: SuggestionBasis): string {
  switch (b) {
    case 'exact':            return 'Exact shape · color · clarity · cut · carat ±10%';
    case 'relaxed_cut':      return 'Shape · color · clarity · carat ±10% (any cut)';
    case 'relaxed_clarity':  return 'Shape · color · carat ±10% (any clarity/cut)';
    case 'shape_color_only': return 'Shape · color (any carat/clarity/cut)';
    case 'shape_only':       return 'Shape only — weak signal';
    case 'no_match':         return 'No comparable stones found';
  }
}
