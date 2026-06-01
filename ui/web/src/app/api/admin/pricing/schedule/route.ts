import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/adminGuard';
import { getSchedule, updateSchedule } from '@/lib/pricingSchedule';
import { audit } from '@/lib/audit';

/** GET /api/admin/pricing/schedule — read current config + last/next run info. */
export async function GET(req: Request) {
  const guard = await requireAdmin(req, 'pricing', 'view');
  if (!guard.ok) return guard.response;
  const sched = await getSchedule();
  return NextResponse.json({ schedule: sched });
}

const patchSchema = z.object({
  enabled:        z.boolean().optional(),
  frequency:      z.enum(['DAILY', 'WEEKLY', 'CUSTOM']).optional(),
  timeOfDay:      z.string().regex(/^\d{1,2}:\d{2}$/, '24-hour HH:MM').optional(),
  dayOfWeek:      z.number().int().min(0).max(6).optional(),
  customCron:     z.string().nullable().optional(),
  mode:           z.enum(['ai', 'heuristic']).optional(),
  rapDiscountPct: z.coerce.number().min(0).max(99).optional(),
  skipIfRecentHrs: z.number().int().min(0).max(168).optional(),
});

/** PATCH — update schedule. Recomputes nextRunAt. */
export async function PATCH(req: Request) {
  const guard = await requireAdmin(req, 'pricing', 'edit');
  if (!guard.ok) return guard.response;
  const body = patchSchema.parse(await req.json());

  const before = await getSchedule();
  const updated = await updateSchedule({ ...body, updatedBy: guard.admin.id });

  await audit({
    actorId: guard.admin.id, action: 'permission.replace', // re-using generic "config edit" bucket
    targetType: 'PricingSchedule', targetId: updated.id,
    oldValue: {
      enabled: before.enabled, frequency: before.frequency,
      timeOfDay: before.timeOfDay, dayOfWeek: before.dayOfWeek,
      mode: before.mode, rapDiscountPct: Number(before.rapDiscountPct),
    },
    newValue: {
      enabled: updated.enabled, frequency: updated.frequency,
      timeOfDay: updated.timeOfDay, dayOfWeek: updated.dayOfWeek,
      mode: updated.mode, rapDiscountPct: Number(updated.rapDiscountPct),
    },
    notes: 'pricing.schedule.update',
  });

  return NextResponse.json({ schedule: updated });
}
