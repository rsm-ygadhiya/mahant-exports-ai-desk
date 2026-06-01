import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminGuard';
import { manualRunNow } from '@/lib/pricingSchedule';
import { audit } from '@/lib/audit';

/**
 * POST /api/admin/pricing/schedule/run-now
 *
 * Triggers the scheduled pricing engine immediately, ignoring the cadence.
 * Useful for testing a fresh config before letting it run on its own time.
 *
 * Permission: pricing.run.
 */
export async function POST(req: Request) {
  const guard = await requireAdmin(req, 'pricing', 'run');
  if (!guard.ok) return guard.response;
  try {
    const { runId } = await manualRunNow(guard.admin.id);
    await audit({
      actorId: guard.admin.id, action: 'pricing.run.create',
      targetType: 'PricingRun', targetId: runId,
      notes: 'Manual run-now from scheduler',
    });
    return NextResponse.json({ runId });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'engine failed' }, { status: 500 });
  }
}
