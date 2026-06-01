// Per-stone history. Merges two sources into a single timeline:
//
//   1. AuditLog rows where targetType=Diamond — captures inline edits,
//      status flips, Excel imports for this specific stone.
//   2. PricingProposal rows with status=APPLIED — captures formal repricing
//      runs that touched this stone (and crucially, *which run* did it).
//
// Spec reference: admin_panel_spec.md §4.1 "Price history log per stone
// (who changed it, when, old vs new value)".

import { prisma } from './db';

export type PriceEventType =
  | 'created'        // initial import / creation
  | 'set_live'       // NOT_LIVE → AVAILABLE with a price approval
  | 'price_edit'     // direct admin edit via stock list
  | 'status_change'  // mark sold / on memo / available
  | 'pricing_run'    // formal pricing run applied
  | 'other';

export type PriceEvent = {
  id: string;
  at: Date;
  type: PriceEventType;
  /** Friendly one-line label rendered in the timeline. */
  label: string;
  /** Optional money snapshot of price-per-carat values. */
  oldPpc?: number | null;
  newPpc?: number | null;
  /** Optional status snapshot — when this event flipped the stone's status. */
  oldStatus?: string | null;
  newStatus?: string | null;
  /** Free-text reasoning (from pricing proposal) or notes. */
  reasoning?: string | null;
  /** Who. */
  actor?: { id: string; name: string; email: string; role: string } | null;
  /** Optional deep link target (e.g. pricing run id). */
  link?: { href: string; label: string } | null;
};

export async function getPriceHistoryForStone(diamondId: string): Promise<PriceEvent[]> {
  const [diamond, audit, applied] = await Promise.all([
    prisma.diamond.findUnique({
      where: { id: diamondId },
      select: { id: true, stoneId: true, createdAt: true, pricePerCarat: true },
    }),
    prisma.auditLog.findMany({
      where: { targetType: 'Diamond', targetId: diamondId },
      orderBy: { createdAt: 'asc' },
      include: { actor: { select: { id: true, name: true, email: true, role: true } } },
    }),
    prisma.pricingProposal.findMany({
      where: { diamondId, status: 'APPLIED' },
      orderBy: { decidedAt: 'asc' },
      include: {
        run: { select: { id: true, mode: true, appliedAt: true } },
      },
    }),
  ]);

  if (!diamond) return [];

  const events: PriceEvent[] = [];

  // Seed: stone created.
  events.push({
    id: 'created:' + diamond.id,
    at: diamond.createdAt,
    type: 'created',
    label: `Stone created (${diamond.stoneId})`,
    newPpc: Number(diamond.pricePerCarat),
    actor: null,
  });

  // Audit-sourced events.
  for (const e of audit) {
    const action = e.action;
    const old = (e.oldValue ?? {}) as any;
    const next = (e.newValue ?? {}) as any;

    if (action === 'stone.edit') {
      const oldPpc = typeof old.pricePerCarat === 'number' ? old.pricePerCarat : null;
      const newPpc = typeof next.pricePerCarat === 'number' ? next.pricePerCarat : null;
      const priceChanged = oldPpc != null && newPpc != null && oldPpc !== newPpc;
      events.push({
        id: e.id, at: e.createdAt,
        type: priceChanged ? 'price_edit' : 'other',
        label: priceChanged
          ? `Price edited inline`
          : `Stone fields edited`,
        oldPpc, newPpc,
        actor: e.actor,
        reasoning: e.notes,
      });
    } else if (action === 'stone.set_live') {
      events.push({
        id: e.id, at: e.createdAt,
        type: 'set_live',
        label: 'Set Live (initial price approved)',
        oldStatus: old.status ?? 'NOT_LIVE',
        newStatus: 'AVAILABLE',
        oldPpc: typeof old.pricePerCarat === 'number' ? old.pricePerCarat : null,
        newPpc: typeof next.pricePerCarat === 'number' ? next.pricePerCarat : null,
        actor: e.actor,
        reasoning: e.notes,
      });
    } else if (action === 'stone.status_change') {
      events.push({
        id: e.id, at: e.createdAt, type: 'status_change',
        label: `Status changed ${old.status ?? '?'} → ${next.status ?? '?'}`,
        oldStatus: old.status ?? null, newStatus: next.status ?? null,
        actor: e.actor,
      });
    } else if (action === 'stone.delete' || action === 'stone.import') {
      // Not interesting for a per-stone history except as a marker.
      continue;
    }
    // ignore other action types
  }

  // Applied pricing proposals.
  for (const p of applied) {
    events.push({
      id: 'prop:' + p.id,
      at: p.decidedAt ?? p.run?.appliedAt ?? new Date(),
      type: 'pricing_run',
      label: `Repriced via pricing run (${p.run?.mode === 'ai' ? '✨ AI' : '⚡ Heuristic'})`,
      oldPpc: Number(p.oldPpc),
      newPpc: Number(p.proposedPpc),
      reasoning: p.reasoning,
      actor: null,                          // run-level, no individual actor surface here
      link: p.runId ? { href: `/admin/pricing/runs/${p.runId}`, label: 'Open pricing run →' } : null,
    });
  }

  // Sort newest-first for display.
  events.sort((a, b) => b.at.getTime() - a.at.getTime());
  return events;
}
