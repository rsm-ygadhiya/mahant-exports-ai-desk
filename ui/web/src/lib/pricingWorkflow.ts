// Pricing-run engine.
//
// A "pricing run" is a draft batch of price proposals you can review and apply.
// The engine takes available stones + uploaded Rap rates and produces one
// `PricingProposal` per stone with a recommended new $/ct + reasoning.
//
// Two modes:
//   - 'heuristic' : deterministic rules (Rap × discount curve × age), runs locally.
//   - 'ai'        : sends the same data to GPT-4o for nuanced category-aware decisions.
//
// Nothing touches live `Diamond.pricePerCarat` until `applyPricingRun(runId, …)`
// is called explicitly with the admin's password.

import { prisma } from '@/lib/db';
import { askJson, AI_AVAILABLE } from '@/lib/ai';
import { findRapRate } from '@/lib/rapImport';

export type PricingMode = 'ai' | 'heuristic';

const D = 86_400_000;

// ─────────────────── Engine input ───────────────────

type StoneInput = {
  diamondId: string;
  stoneId: string;
  shape: string;
  carat: number;
  color: string;
  clarity: string;
  pricePerCarat: number;      // current $/ct
  discountPct: number | null;
  ageDays: number;
  enquiryCount30d: number;    // recent demand signal
  rapPerCt: number | null;    // looked-up Rap (or null)
  rapSheetDate?: Date;
};

async function gatherInputs(): Promise<StoneInput[]> {
  const [stones, allRap, enqItems] = await Promise.all([
    prisma.diamond.findMany({
      where: { status: 'AVAILABLE' },
      orderBy: { createdAt: 'asc' },
    }),
    // Single fetch of ALL Rap rates — we match by (shape, color, clarity, carat) in memory.
    prisma.rapRate.findMany({
      orderBy: { sheetDate: 'desc' }, // newest first so first hit wins
    }),
    prisma.enquiryItem.findMany({
      where: { enquiry: { createdAt: { gte: new Date(Date.now() - 30 * D) } } },
      select: { diamond: { select: { shape: true, color: true, clarity: true } } },
    }),
  ]);

  // Build in-memory Rap index: (shape|COLOR|CLARITY) → list of (caratMin, caratMax, ratePerCt, sheetDate)
  // already sorted newest-first, so the first carat match is the freshest.
  type RapBucket = { caratMin: number; caratMax: number; ratePerCt: number; sheetDate: Date };
  const rapIndex = new Map<string, RapBucket[]>();
  for (const r of allRap) {
    const k = `${r.shape}|${r.color}|${r.clarity}`;
    let arr = rapIndex.get(k);
    if (!arr) { arr = []; rapIndex.set(k, arr); }
    arr.push({
      caratMin: Number(r.caratMin),
      caratMax: Number(r.caratMax),
      ratePerCt: Number(r.ratePerCt),
      sheetDate: r.sheetDate,
    });
  }
  const findRap = (shape: string, color: string, clarity: string, carat: number): RapBucket | null => {
    const arr = rapIndex.get(`${shape}|${color.toUpperCase()}|${clarity.toUpperCase()}`);
    if (!arr) return null;
    for (const b of arr) if (carat >= b.caratMin && carat < b.caratMax) return b;
    return null;
  };

  const demandKey = new Map<string, number>();
  for (const it of enqItems) {
    const k = `${it.diamond.shape}/${it.diamond.color}/${it.diamond.clarity}`;
    demandKey.set(k, (demandKey.get(k) ?? 0) + 1);
  }

  const now = Date.now();
  return stones.map(s => {
    const carat = Number(s.carat);
    const rap = findRap(s.shape, s.color, s.clarity, carat);
    const dk = `${s.shape}/${s.color}/${s.clarity}`;
    return {
      diamondId: s.id,
      stoneId: s.stoneId,
      shape: s.shape,
      carat,
      color: s.color,
      clarity: s.clarity,
      pricePerCarat: Number(s.pricePerCarat),
      discountPct: s.discountPct == null ? null : Number(s.discountPct),
      ageDays: Math.floor((now - s.createdAt.getTime()) / D),
      enquiryCount30d: demandKey.get(dk) ?? 0,
      rapPerCt: rap?.ratePerCt ?? null,
      rapSheetDate: rap?.sheetDate,
    };
  });
}

// ─────────────────── Heuristic engine ───────────────────

type Proposal = {
  diamondId: string;
  oldPpc: number;
  proposedPpc: number;
  rapPrice: number | null;
  changePct: number;
  reasoning: string;
};

function heuristicProposalFor(s: StoneInput, rapMultiplier: number): Proposal {
  const oldPpc = s.pricePerCarat;
  let basis = oldPpc;
  let basisLabel = 'current $/ct';

  // Rap-anchored when available. For lab-grown vs natural Rap, real-world
  // wholesale is typically a 95%+ discount off Rap (rapMultiplier ≈ 0.03–0.07).
  if (s.rapPerCt) {
    basis = s.rapPerCt * rapMultiplier;
    const discPct = Math.round((1 - rapMultiplier) * 100);
    basisLabel = `Rap $${s.rapPerCt}/ct − ${discPct}% disc`;
  }

  // Aging multiplier — older stones get progressive discounts.
  let ageMult = 1.0; let ageNote = '';
  if (s.ageDays >= 90)      { ageMult = 0.85; ageNote = `${s.ageDays}d old (-15%)`; }
  else if (s.ageDays >= 60) { ageMult = 0.92; ageNote = `${s.ageDays}d old (-8%)`; }
  else if (s.ageDays >= 45) { ageMult = 0.97; ageNote = `${s.ageDays}d old (-3%)`; }
  else if (s.ageDays >= 30) { ageMult = 0.99; ageNote = `${s.ageDays}d old (-1%)`; }

  // Demand multiplier — categories with recent enquiries hold price better.
  let demandMult = 1.0; let demandNote = '';
  if (s.enquiryCount30d >= 5)      { demandMult = 1.02; demandNote = `${s.enquiryCount30d} recent enquiries (+2%)`; }
  else if (s.enquiryCount30d >= 2) { demandMult = 1.0;  demandNote = `${s.enquiryCount30d} recent enquiries (neutral)`; }
  else if (s.enquiryCount30d === 0 && s.ageDays > 30) {
    demandMult = 0.97; demandNote = `no recent enquiries (-3%)`;
  }

  const proposed = Math.max(1, basis * ageMult * demandMult);
  // Round to nearest $5.
  const newPpc = Math.round(proposed / 5) * 5;
  // Margin floor — never drop more than 25% from current in one pass.
  const floor = oldPpc * 0.75;
  const finalPpc = Math.max(newPpc, Math.round(floor / 5) * 5);

  const changePct = oldPpc > 0 ? ((finalPpc - oldPpc) / oldPpc) * 100 : 0;
  const parts = [`Basis: ${basisLabel}`];
  if (ageNote) parts.push(ageNote);
  if (demandNote) parts.push(demandNote);
  if (finalPpc !== newPpc) parts.push('clamped to 25% margin floor');
  const reasoning = parts.join('; ') + '.';

  return {
    diamondId: s.diamondId,
    oldPpc,
    proposedPpc: finalPpc,
    rapPrice: s.rapPerCt,
    changePct,
    reasoning,
  };
}

function heuristicEngine(stones: StoneInput[], rapMultiplier: number): { proposals: Proposal[]; summary: string } {
  const proposals = stones.map(s => heuristicProposalFor(s, rapMultiplier));
  const changed = proposals.filter(p => Math.round(p.proposedPpc) !== Math.round(p.oldPpc));
  const drops = changed.filter(p => p.proposedPpc < p.oldPpc);
  const avgMove = changed.length ? changed.reduce((s, p) => s + p.changePct, 0) / changed.length : 0;
  const haveRap = stones.filter(s => s.rapPerCt != null).length;
  const discPct = Math.round((1 - rapMultiplier) * 100);
  const summary = `${stones.length} available stones repriced. ${changed.length} proposals (${drops.length} discounts, avg ${avgMove.toFixed(1)}%). ${haveRap}/${stones.length} matched a Rap rate; the rest fall back to current $/ct as basis. Heuristic: Rap basis − ${discPct}% discount × age curve × demand signal, rounded to $5, with a 25% margin floor.`;
  return { proposals, summary };
}

// ─────────────────── AI engine ───────────────────

const AI_SYSTEM = `You are the weekly repricing engine for Mahant Exports, a B2B lab-grown diamond wholesaler.

For each available stone, you recommend a new price-per-carat using these factors:

1. **Rap anchor** — when a Rap rate is available, lab-grown typically trades at 80-90% of Rap. Use this as the basis.
2. **Aging in stock** — progressive discounts (3-5% at 30d, 8-12% at 60d, 15-20% at 90d+).
3. **Category velocity** — Round + 1-2ct + VS-VVS turns fast (small reduction); Fancy + 3ct+ + SI turns slow (deeper).
4. **Demand signal** — categories with enquiries can hold price; zero-enquiry slow movers should drop more.
5. **Existing discount %** — already-discounted stones move further.
6. **Margin floor** — never drop more than 25% in a single pass.
7. **Round to nearest $5**.

Output one proposal per stone — even if unchanged. Reasoning should cite the specific factors that drove the number.`;

const AI_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stoneId: { type: 'string' },
          newPpc: { type: 'number' },
          reasoning: { type: 'string' },
        },
        required: ['stoneId', 'newPpc', 'reasoning'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['proposals', 'summary'],
};

async function aiEngine(stones: StoneInput[], rapMultiplier: number): Promise<{ proposals: Proposal[]; summary: string }> {
  // Cap at 200 stones for one AI call to keep token costs bounded.
  const slice = stones.slice(0, 200);
  const lines = slice.map(s =>
    `${s.stoneId} | ${s.shape} ${s.carat.toFixed(2)}ct ${s.color}/${s.clarity} | $${s.pricePerCarat}/ct | disc ${s.discountPct ?? 0}% | age ${s.ageDays}d | enq30d=${s.enquiryCount30d} | Rap ${s.rapPerCt ? '$' + s.rapPerCt : '-'}`,
  ).join('\n');

  const cachedContext = `=== AVAILABLE STOCK (oldest first) ===\n${lines}`;
  const userMessage = `Reprice every stone above. Return one proposal per stone with stoneId, newPpc, and a single-sentence reasoning. Then a summary paragraph.`;

  const { data } = await askJson<{ proposals: Array<{ stoneId: string; newPpc: number; reasoning: string }>; summary: string }>({
    system: AI_SYSTEM,
    cachedContext,
    userMessage,
    schema: AI_SCHEMA,
  });

  const byStoneId = new Map<string, StoneInput>();
  for (const s of slice) byStoneId.set(s.stoneId, s);
  const proposals: Proposal[] = [];
  for (const p of data.proposals) {
    const s = byStoneId.get(p.stoneId);
    if (!s) continue;
    const oldPpc = s.pricePerCarat;
    const changePct = oldPpc > 0 ? ((p.newPpc - oldPpc) / oldPpc) * 100 : 0;
    proposals.push({
      diamondId: s.diamondId,
      oldPpc,
      proposedPpc: p.newPpc,
      rapPrice: s.rapPerCt,
      changePct,
      reasoning: p.reasoning,
    });
  }
  // Stones beyond the AI cap fall back to heuristic so the run covers the full inventory.
  for (let i = slice.length; i < stones.length; i++) {
    const fallback = heuristicProposalFor(stones[i], rapMultiplier);
    proposals.push({ ...fallback, reasoning: `[heuristic — beyond AI batch] ${fallback.reasoning}` });
  }
  return { proposals, summary: data.summary };
}

// ─────────────────── Public API ───────────────────

/**
 * Generate a new pricing run with one DRAFT proposal per available stone.
 * Persists the run + proposals; nothing applied to live stock yet.
 */
/**
 * `rapMultiplier`: fraction of Rap to use as the basis for a stone's $/ct.
 * Equivalent to `1 - discountOffRap`.
 *
 * For lab-grown anchored to NATURAL Rap sheets, real-world wholesale is
 * typically a 95%+ discount off Rap — i.e. `rapMultiplier ≈ 0.03–0.07`.
 * The admin desk's actual workflow:
 *   1. Read Rap
 *   2. Factor unit economics (cost basis)
 *   3. Check Nivoda / other marketplaces for the first comparable stone
 *   4. Apply a 95%+ discount to the Rap to land at the final $/ct
 *
 * Default 0.05 (= 95% discount off Rap), which matches typical lab-grown
 * wholesale. The admin overrides per run if the market moves.
 *
 * For lab-grown INDEX sheets (rare), set `rapMultiplier ≈ 0.85`.
 */
export async function startPricingRun(args: {
  adminId: string;
  mode: PricingMode;
  notes?: string;
  rapMultiplier?: number;
}): Promise<{ runId: string }> {
  const rapMultiplier = args.rapMultiplier ?? 0.05;
  if (rapMultiplier <= 0 || rapMultiplier > 2) {
    throw new Error('rapMultiplier must be between 0 and 2');
  }
  const stones = await gatherInputs();
  if (stones.length === 0) {
    throw new Error('No available stones to reprice.');
  }
  if (args.mode === 'ai' && !AI_AVAILABLE()) {
    throw new Error('OPENAI_API_KEY not configured. Use heuristic mode or add the key to .env.');
  }

  const { proposals, summary } = args.mode === 'ai'
    ? await aiEngine(stones, rapMultiplier)
    : heuristicEngine(stones, rapMultiplier);

  // Use the most recent Rap sheet date among the inputs (informational only).
  const rapDates = stones.map(s => s.rapSheetDate?.getTime()).filter((x): x is number => Boolean(x));
  const rapDate = rapDates.length ? new Date(Math.max(...rapDates)) : null;

  const run = await prisma.pricingRun.create({
    data: {
      createdBy: args.adminId,
      mode: args.mode,
      rapDate,
      summary,
      notes: args.notes,
      proposals: {
        create: proposals.map(p => ({
          diamondId: p.diamondId,
          oldPpc: p.oldPpc as any,
          proposedPpc: p.proposedPpc as any,
          rapPrice: p.rapPrice == null ? null : (p.rapPrice as any),
          changePct: p.changePct as any,
          reasoning: p.reasoning,
        })),
      },
    },
  });
  return { runId: run.id };
}

/**
 * Apply approved proposals to live stock. Idempotent — re-running on the
 * same run only applies proposals that are still APPROVED (not yet APPLIED).
 *
 * Updates Diamond.pricePerCarat AND totalPrice (carat × new ppc).
 * Marks each applied proposal as APPLIED, marks the run as APPLIED.
 */
export async function applyPricingRun(runId: string, adminId: string): Promise<{ applied: number }> {
  const proposals = await prisma.pricingProposal.findMany({
    where: { runId, status: 'APPROVED' },
    include: { diamond: { select: { carat: true, stoneId: true } } },
  });

  let applied = 0;
  for (const p of proposals) {
    const carat = Number(p.diamond.carat);
    const newPpc = Number(p.proposedPpc);
    const newTotal = newPpc * carat;
    await prisma.$transaction([
      prisma.diamond.update({
        where: { id: p.diamondId },
        data: {
          pricePerCarat: newPpc as any,
          totalPrice: newTotal as any,
          discountPct: Number(p.changePct) as any,
        },
      }),
      prisma.pricingProposal.update({
        where: { id: p.id },
        data: { status: 'APPLIED', decidedAt: new Date(), decidedBy: adminId },
      }),
    ]);
    applied++;
  }

  await prisma.pricingRun.update({
    where: { id: runId },
    data: { status: 'APPLIED', appliedAt: new Date() },
  });
  return { applied };
}
