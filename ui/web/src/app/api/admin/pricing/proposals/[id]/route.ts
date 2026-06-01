import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/adminGuard';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';

/**
 * PATCH /api/admin/pricing/proposals/:id
 *
 * Per-stone manual override. Use after consulting Nivoda or other marketplace
 * comparables to override the engine's $/ct and capture a custom reasoning note.
 *
 * Body: { proposedPpc?: number, reasoning?: string }
 *
 * Only proposals not yet APPLIED can be edited.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req, 'pricing', 'edit');
  if (!guard.ok) return guard.response;

  const body = z.object({
    proposedPpc: z.coerce.number().positive().optional(),
    reasoning: z.string().min(1).max(2000).optional(),
  }).parse(await req.json());

  if (body.proposedPpc == null && body.reasoning == null) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const existing = await prisma.pricingProposal.findUnique({
    where: { id: params.id },
    include: { diamond: { select: { carat: true } } },
  });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (existing.status === 'APPLIED') {
    return NextResponse.json({ error: 'cannot edit APPLIED proposals' }, { status: 409 });
  }

  const data: any = {};
  if (body.proposedPpc != null) {
    data.proposedPpc = body.proposedPpc;
    const oldPpc = Number(existing.oldPpc);
    data.changePct = oldPpc > 0 ? ((body.proposedPpc - oldPpc) / oldPpc) * 100 : 0;
  }
  if (body.reasoning != null) {
    data.reasoning = body.reasoning.trim();
  }

  const updated = await prisma.pricingProposal.update({ where: { id: params.id }, data });

  await audit({
    actorId: guard.admin.id, action: 'pricing.proposal_edit',
    targetType: 'PricingProposal', targetId: updated.id,
    oldValue: {
      proposedPpc: Number(existing.proposedPpc),
      reasoning: existing.reasoning,
    },
    newValue: {
      ...(body.proposedPpc != null ? { proposedPpc: body.proposedPpc } : {}),
      ...(body.reasoning != null ? { reasoning: body.reasoning.trim() } : {}),
    },
  });

  return NextResponse.json({ proposal: updated });
}
