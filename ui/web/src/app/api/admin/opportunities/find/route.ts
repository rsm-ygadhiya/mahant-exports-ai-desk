/**
 * POST /api/admin/opportunities/find
 *   body: { regions: Region[] }
 *
 * Filters the seed list to the chosen regions, enriches via Claude
 * (fit_summary, contact_role, confidence), persists, and returns the list.
 */

import { NextResponse } from 'next/server';
import { requireLoggedInAdmin } from '@/lib/adminGuard';
import { hasPermission } from '@/lib/permissions';
import { SEED, ALL_REGIONS, type Region } from '@/lib/opportunities/seed';
import { enrichBatch } from '@/lib/opportunities/enrich';
import { getAll, upsertMany } from '@/lib/opportunities/store';

export async function POST(req: Request) {
  const guard = await requireLoggedInAdmin(req);
  if (!guard.ok) return guard.response;
  if (!hasPermission(guard.admin as any, 'ai_briefing', 'view')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: { regions?: Region[] } = {};
  try { body = await req.json(); } catch { /* ignore — fall back to all */ }
  const regions = (body.regions && body.regions.length > 0)
    ? body.regions.filter(r => ALL_REGIONS.includes(r))
    : ALL_REGIONS;

  const seeds = SEED.filter(s => regions.includes(s.region));

  // Preserve any in-flight opportunities for these IDs (don't clobber
  // emails the user has already drafted). Only re-enrich `new` ones.
  const existing = await getAll();
  const byId = new Map(existing.map(o => [o.id, o]));
  const toEnrich = seeds.filter(s => {
    const cur = byId.get(s.id);
    return !cur || cur.status === 'new';
  });

  const enriched = await enrichBatch(toEnrich);
  await upsertMany(enriched);

  const merged = seeds.map(s => byId.get(s.id) ?? enriched.find(e => e.id === s.id)!);
  // Sort by confidence desc so the best leads float to the top
  merged.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

  return NextResponse.json({
    regions,
    count: merged.length,
    opportunities: merged,
  });
}
