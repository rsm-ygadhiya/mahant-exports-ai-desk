import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/adminGuard';
import { prisma } from '@/lib/db';

/**
 * POST /api/admin/pricing/runs/:id/bulk-disc
 *
 * Set the proposed $/ct for a list of proposals to a specified discount-off-Rap.
 * Useful when the admin filters down to a category (e.g. all Rounds 1-2ct VS+)
 * and wants to set the same discount across the slice.
 *
 * Body: { ids: string[], discountOffRapPct: number }
 *
 * For proposals with no Rap match, applies the same percentage discount to the
 * current $/ct (oldPpc) so the request still affects the slice.
 * Skips APPLIED proposals.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req, 'pricing', 'edit');
  if (!guard.ok) return guard.response;

  const body = z.object({
    ids: z.array(z.string()).min(1),
    discountOffRapPct: z.coerce.number().min(0).max(99),
  }).parse(await req.json());

  const proposals = await prisma.pricingProposal.findMany({
    where: { runId: params.id, id: { in: body.ids }, status: { not: 'APPLIED' } },
  });

  const factor = 1 - body.discountOffRapPct / 100;
  let updated = 0;
  const note = `Manual: ${body.discountOffRapPct.toFixed(1)}% off Rap`;
  for (const p of proposals) {
    const basis = p.rapPrice == null ? Number(p.oldPpc) : Number(p.rapPrice);
    const newPpc = Math.max(1, Math.round((basis * factor) / 5) * 5);
    const oldPpc = Number(p.oldPpc);
    const changePct = oldPpc > 0 ? ((newPpc - oldPpc) / oldPpc) * 100 : 0;
    await prisma.pricingProposal.update({
      where: { id: p.id },
      data: {
        proposedPpc: newPpc as any,
        changePct: changePct as any,
        reasoning: p.rapPrice == null
          ? `${note} (no Rap match — applied to current $/ct as basis).`
          : `${note}: $${basis}/ct × ${(factor * 100).toFixed(1)}% → $${newPpc}/ct.`,
      },
    });
    updated++;
  }

  return NextResponse.json({ updated });
}
