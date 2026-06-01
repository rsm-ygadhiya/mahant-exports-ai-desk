// Pricing scheduler — singleton config + tick handler.
//
// We keep the math simple: DAILY fires at `timeOfDay`, WEEKLY fires on
// `dayOfWeek` at `timeOfDay`. Times are interpreted in the server's local
// timezone (set TZ env on the host for production).
//
// CUSTOM (full cron expression) is left as a stub — wiring a real cron
// parser is fine for a future iteration; almost everyone wants DAILY.

import { prisma } from './db';
import { startPricingRun } from './pricingWorkflow';
import { audit } from './audit';

const SCHEDULE_ID = 'default';

export async function getSchedule() {
  // Ensure a row exists so the UI always has something to display.
  return prisma.pricingSchedule.upsert({
    where: { id: SCHEDULE_ID },
    update: {},
    create: { id: SCHEDULE_ID },
  });
}

export type ScheduleUpdate = {
  enabled?: boolean;
  frequency?: 'DAILY' | 'WEEKLY' | 'CUSTOM';
  timeOfDay?: string;
  dayOfWeek?: number;
  customCron?: string | null;
  mode?: 'ai' | 'heuristic';
  rapDiscountPct?: number;
  skipIfRecentHrs?: number;
};

export async function updateSchedule(args: ScheduleUpdate & { updatedBy: string }) {
  const cur = await getSchedule();
  const merged = { ...cur, ...args };
  const nextRunAt = computeNextRunAt(merged as any, new Date());
  const updated = await prisma.pricingSchedule.update({
    where: { id: SCHEDULE_ID },
    data: {
      ...args,
      nextRunAt: merged.enabled ? nextRunAt : null,
      updatedBy: args.updatedBy,
    },
  });
  return updated;
}

/**
 * Compute the next time the schedule should fire after `from`.
 * Returns null for invalid/disabled configs.
 */
export function computeNextRunAt(
  s: { frequency: 'DAILY' | 'WEEKLY' | 'CUSTOM'; timeOfDay: string; dayOfWeek: number; enabled: boolean },
  from: Date,
): Date | null {
  if (!s.enabled) return null;
  if (s.frequency === 'CUSTOM') return null; // not implemented yet

  const m = /^(\d{1,2}):(\d{2})$/.exec(s.timeOfDay);
  if (!m) return null;
  const hour = Math.min(23, Math.max(0, Number(m[1])));
  const minute = Math.min(59, Math.max(0, Number(m[2])));

  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);

  if (s.frequency === 'DAILY') {
    // If we've already passed today's time, push to tomorrow.
    if (next <= from) next.setDate(next.getDate() + 1);
    return next;
  }

  // WEEKLY
  const target = ((s.dayOfWeek ?? 1) % 7 + 7) % 7;   // 0..6
  let daysAhead = (target - next.getDay() + 7) % 7;
  // If today is the right day-of-week but we've already passed the time, push to next week.
  if (daysAhead === 0 && next <= from) daysAhead = 7;
  next.setDate(next.getDate() + daysAhead);
  return next;
}

/**
 * The cron tick handler. Called by the external scheduler at any cadence
 * (typically every 5–10 minutes); we check whether the schedule is due.
 *
 * Returns one of:
 *   { fired: true, runId }    — a PricingRun was created
 *   { fired: false, reason }  — disabled / not due / recent run blocked
 *   { fired: false, error }   — engine threw
 */
export async function tickPricingSchedule(): Promise<
  | { fired: true; runId: string; nextRunAt: Date | null }
  | { fired: false; reason: string; nextRunAt: Date | null }
> {
  const sched = await getSchedule();
  const now = new Date();

  if (!sched.enabled) {
    return { fired: false, reason: 'schedule disabled', nextRunAt: null };
  }
  if (!sched.nextRunAt || sched.nextRunAt > now) {
    return { fired: false, reason: 'not yet due', nextRunAt: sched.nextRunAt };
  }

  // Don't pile draft runs on top of recent ones.
  const recentSince = new Date(now.getTime() - sched.skipIfRecentHrs * 3600_000);
  const recent = await prisma.pricingRun.findFirst({
    where: { status: 'DRAFT', createdAt: { gte: recentSince } },
    select: { id: true, createdAt: true },
  });

  // Always advance nextRunAt so we don't retry in a tight loop.
  const nextRunAt = computeNextRunAt(sched as any, new Date(now.getTime() + 60_000));

  if (recent) {
    await prisma.pricingSchedule.update({
      where: { id: SCHEDULE_ID },
      data: {
        lastRunAt: now, lastRunStatus: 'skipped',
        lastError: `Existing DRAFT run from ${recent.createdAt.toISOString()} — skipped to avoid duplicates.`,
        nextRunAt,
      },
    });
    return { fired: false, reason: 'recent draft run exists', nextRunAt };
  }

  // Fire the run. Use a system-owned admin id so audit shows the cron.
  const adminId = await pickSystemAdminId();

  try {
    const { runId } = await startPricingRun({
      adminId,
      mode: sched.mode === 'ai' ? 'ai' : 'heuristic',
      rapMultiplier: (100 - Number(sched.rapDiscountPct)) / 100,
      notes: `Scheduled run — ${sched.frequency.toLowerCase()} at ${sched.timeOfDay}`,
    });

    await prisma.pricingSchedule.update({
      where: { id: SCHEDULE_ID },
      data: { lastRunAt: now, lastRunId: runId, lastRunStatus: 'ok', lastError: null, nextRunAt },
    });
    await audit({
      actorId: adminId, action: 'pricing.run.create',
      targetType: 'PricingRun', targetId: runId,
      notes: 'Triggered by cron schedule',
    });

    return { fired: true, runId, nextRunAt };
  } catch (err: any) {
    await prisma.pricingSchedule.update({
      where: { id: SCHEDULE_ID },
      data: { lastRunAt: now, lastRunStatus: 'error', lastError: err?.message ?? String(err), nextRunAt },
    });
    return { fired: false, reason: 'engine error: ' + (err?.message ?? err), nextRunAt };
  }
}

/** Manual "Run now" — same engine path, no due-check. */
export async function manualRunNow(adminId: string): Promise<{ runId: string }> {
  const sched = await getSchedule();
  const { runId } = await startPricingRun({
    adminId,
    mode: sched.mode === 'ai' ? 'ai' : 'heuristic',
    rapMultiplier: (100 - Number(sched.rapDiscountPct)) / 100,
    notes: `Manual run from scheduler — ${new Date().toISOString()}`,
  });
  // Don't bump nextRunAt — manual runs are out-of-band.
  await prisma.pricingSchedule.update({
    where: { id: SCHEDULE_ID },
    data: { lastRunAt: new Date(), lastRunId: runId, lastRunStatus: 'ok', lastError: null },
  });
  return { runId };
}

async function pickSystemAdminId(): Promise<string> {
  // Use the oldest OWNER as the "system" actor for audit purposes.
  const owner = await prisma.admin.findFirst({
    where: { role: 'OWNER', isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!owner) throw new Error('No active OWNER admin to attribute the scheduled run to.');
  return owner.id;
}
