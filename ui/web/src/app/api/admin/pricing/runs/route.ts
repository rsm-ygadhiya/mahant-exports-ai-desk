import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/adminGuard';
import { startPricingRun } from '@/lib/pricingWorkflow';
import { audit } from '@/lib/audit';

/**
 * POST /api/admin/pricing/runs — start a new pricing run.
 * body: { mode: 'ai' | 'heuristic', notes?: string }
 */
export async function POST(req: Request) {
  const guard = await requireAdmin(req, 'pricing', 'run');
  if (!guard.ok) return guard.response;
  const admin = guard.admin;

  const body = z.object({
    mode: z.enum(['ai', 'heuristic']).default('heuristic'),
    notes: z.string().optional(),
    rapMultiplier: z.coerce.number().positive().max(2).optional(),
  }).parse(await req.json().catch(() => ({})));

  try {
    const { runId } = await startPricingRun({
      adminId: admin.id,
      mode: body.mode,
      notes: body.notes,
      rapMultiplier: body.rapMultiplier,
    });

    await audit({
      actorId: admin.id, action: 'pricing.run.create',
      targetType: 'PricingRun', targetId: runId,
      notes: `mode=${body.mode}${body.rapMultiplier ? ` · ${Math.round((1 - body.rapMultiplier) * 100)}% off Rap` : ''}`,
      newValue: { mode: body.mode, rapMultiplier: body.rapMultiplier, notes: body.notes },
    });

    return NextResponse.json({ runId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'failed to start run' }, { status: 500 });
  }
}
