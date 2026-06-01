import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/adminGuard';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';

/**
 * POST /api/admin/pricing/runs/:id/decide
 *
 * Mark proposals as APPROVED or REJECTED. Two shapes:
 *   { proposalId: string, decision: 'APPROVED' | 'REJECTED' }   // single
 *   { all: 'APPROVE' | 'REJECT' }                                // bulk on still-PENDING
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req, 'pricing', 'approve');
  if (!guard.ok) return guard.response;
  const admin = guard.admin;

  const body = z.union([
    // Single decision
    z.object({ proposalId: z.string(), decision: z.enum(['APPROVED', 'REJECTED', 'PENDING']) }),
    // Bulk on all-pending in the run
    z.object({ all: z.enum(['APPROVE', 'REJECT']) }),
    // Bulk on a specific list of proposal ids (used when gem filters are active)
    z.object({ ids: z.array(z.string()).min(1), decision: z.enum(['APPROVED', 'REJECTED']) }),
  ]).parse(await req.json());

  if ('all' in body) {
    const target = body.all === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const updated = await prisma.pricingProposal.updateMany({
      where: { runId: params.id, status: 'PENDING' },
      data: { status: target, decidedAt: new Date(), decidedBy: admin.id },
    });
    await audit({
      actorId: admin.id, action: 'pricing.run.decide',
      targetType: 'PricingRun', targetId: params.id,
      notes: `bulk ${body.all} all pending · ${updated.count} proposals`,
      newValue: { mode: 'all', decision: target, count: updated.count },
    });
    return NextResponse.json({ updated: updated.count });
  }

  if ('ids' in body) {
    const updated = await prisma.pricingProposal.updateMany({
      where: { runId: params.id, id: { in: body.ids }, status: 'PENDING' },
      data: { status: body.decision, decidedAt: new Date(), decidedBy: admin.id },
    });
    await audit({
      actorId: admin.id, action: 'pricing.run.decide',
      targetType: 'PricingRun', targetId: params.id,
      notes: `${body.decision} ${updated.count} filtered proposals`,
      newValue: { mode: 'filtered', decision: body.decision, count: updated.count },
    });
    return NextResponse.json({ updated: updated.count });
  }

  const updated = await prisma.pricingProposal.update({
    where: { id: body.proposalId },
    data: {
      status: body.decision,
      decidedAt: body.decision === 'PENDING' ? null : new Date(),
      decidedBy: body.decision === 'PENDING' ? null : admin.id,
    },
  });
  await audit({
    actorId: admin.id, action: 'pricing.run.decide',
    targetType: 'PricingProposal', targetId: body.proposalId,
    notes: `decision=${body.decision}`,
  });
  return NextResponse.json({ proposal: updated });
}
