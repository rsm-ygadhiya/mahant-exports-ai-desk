import { prisma } from '@/lib/db';
import { askJson } from '@/lib/ai';

/**
 * Memo decisions use the same three-bucket vocabulary as the Scintilla
 * autopilot's FIFO + HITL gate, so the whole app speaks one language:
 *
 *   AUTO_APPROVE  — keep the memo / grant the hold; clear, safe.
 *   NEEDS_REVIEW  — the human case: a mid-CLV customer tying up multiple
 *                   stones at once. Desk decides.
 *   AUTO_REJECT   — release back to AVAILABLE: held too long, holder isn't
 *                   an approved buyer, or they already had this stone before.
 */
export type MemoDecision = 'AUTO_APPROVE' | 'NEEDS_REVIEW' | 'AUTO_REJECT';

export type MemoReview = {
  stoneId: string;
  customerName: string;
  decision: MemoDecision;
  conditions?: string | null;
  reasoning: string;
};

const SYSTEM = `You are the memo approval advisor for Mahant Exports, a B2B lab-grown diamond wholesaler.

You review stones currently on memo (HOLD-status, reserved by a customer) and route each into exactly one of three buckets, matching the desk's FIFO + human-in-the-loop gate:

- AUTO_APPROVE: the hold is healthy — keep it in place. Recent, single-stone, reliable holder.
- NEEDS_REVIEW: the ONLY case that needs a human — a mid-CLV customer is tying up MORE THAN ONE stone at once. The desk must decide which to keep.
- AUTO_REJECT: release the stone back to AVAILABLE. Use when ANY of these hold:
    • held too long (>14d is concerning, >30d almost always release)
    • the holder is a PENDING / unapproved customer (shouldn't hold at all)
    • the same customer already received this stone before (duplicate)

Decision precedence: AUTO_REJECT conditions win first; then NEEDS_REVIEW (mid-CLV holding multiple); otherwise AUTO_APPROVE.

For NEEDS_REVIEW and AUTO_REJECT, put the concrete next action in "conditions" (e.g. "release back to AVAILABLE", "pick one of the 3 stones to keep"). For AUTO_APPROVE use null.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reviews: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stoneId: { type: 'string' },
          customerName: { type: 'string' },
          decision: { type: 'string', enum: ['AUTO_APPROVE', 'NEEDS_REVIEW', 'AUTO_REJECT'] },
          conditions: { type: ['string', 'null'] },
          reasoning: { type: 'string' },
        },
        required: ['stoneId', 'customerName', 'decision', 'conditions', 'reasoning'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['reviews', 'summary'],
};

export async function runMemoApproval(): Promise<{ reviews: MemoReview[]; summary: string; usage: any }> {
  const memoStones = await prisma.diamond.findMany({
    where: { status: 'HOLD' },
    orderBy: { updatedAt: 'asc' }, // oldest hold first — FIFO ordering
    take: 50,
  });

  // Best-effort attribution: which customer enquired on each stone most recently?
  const enqItems = await prisma.enquiryItem.findMany({
    where: { diamondId: { in: memoStones.map(s => s.id) } },
    include: { enquiry: { include: { customer: { include: { pricingRule: true } } } } },
    orderBy: { enquiry: { createdAt: 'desc' } },
  });
  const stoneToCustomer = new Map<string, { name: string; status: string }>();
  for (const it of enqItems) {
    if (!stoneToCustomer.has(it.diamondId)) {
      stoneToCustomer.set(it.diamondId, {
        name: it.enquiry.customer.companyName,
        status: it.enquiry.customer.status,
      });
    }
  }

  // How many stones is each customer holding right now? (the multi-stone signal)
  const holdCount = new Map<string, number>();
  for (const s of memoStones) {
    const c = stoneToCustomer.get(s.id)?.name ?? 'unknown';
    holdCount.set(c, (holdCount.get(c) ?? 0) + 1);
  }

  const now = Date.now();
  const lines = memoStones.map(d => {
    const days = Math.floor((now - d.updatedAt.getTime()) / 86_400_000);
    const cust = stoneToCustomer.get(d.id);
    const name = cust?.name ?? 'unknown';
    const held = holdCount.get(name) ?? 1;
    return `${d.stoneId}: ${d.shape} ${Number(d.carat).toFixed(2)}ct ${d.color}/${d.clarity} | $${Number(d.totalPrice).toFixed(0)} | on memo ${days}d | reserved by: ${name} (status=${cust?.status ?? 'unknown'}, holding ${held} stone${held === 1 ? '' : 's'})`;
  });

  const cachedContext = `=== STONES CURRENTLY ON MEMO (HOLD), oldest first ===
${lines.join('\n')}`;

  const userMessage = `Route every memo above into AUTO_APPROVE / NEEDS_REVIEW / AUTO_REJECT using the precedence rules. Give a concrete next action in "conditions" for anything not AUTO_APPROVE, plus a one-line reasoning.`;

  const { data, usage } = await askJson<{ reviews: MemoReview[]; summary: string }>({
    system: SYSTEM,
    cachedContext,
    userMessage,
    schema: SCHEMA,
  });
  return { ...data, usage };
}
