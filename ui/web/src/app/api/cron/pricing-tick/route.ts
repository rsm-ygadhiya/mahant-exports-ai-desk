import { NextResponse } from 'next/server';
import { tickPricingSchedule } from '@/lib/pricingSchedule';

/**
 * Cron tick endpoint — fire from an external scheduler every ~5–10 minutes.
 *
 * Auth: requires the `CRON_SECRET` env var in either:
 *   - `x-cron-secret` header (preferred for curl)
 *   - `Authorization: Bearer <CRON_SECRET>` header (Vercel Cron default)
 *
 * If CRON_SECRET is unset (dev), the endpoint accepts unauthenticated calls
 * with a clear warning in the response.
 *
 * The handler is idempotent — calling it more often than needed is safe;
 * it only fires when the schedule's nextRunAt has passed.
 */
function isAuthorised(req: Request): { ok: true } | { ok: false; reason: string } {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: true };
  const fromHeader = req.headers.get('x-cron-secret');
  const fromAuth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (fromHeader === secret || fromAuth === secret) return { ok: true };
  return { ok: false, reason: 'invalid or missing cron secret' };
}

async function tick(req: Request) {
  const auth = isAuthorised(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });

  const result = await tickPricingSchedule();
  return NextResponse.json({
    ...result,
    warning: process.env.CRON_SECRET ? undefined : 'CRON_SECRET is not set — this endpoint is unauthenticated. Set the env var in production.',
  });
}

// Both GET and POST so it works from curl, GitHub Actions, Vercel Cron (GET), etc.
export async function POST(req: Request) { return tick(req); }
export async function GET(req: Request)  { return tick(req); }
