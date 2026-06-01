/**
 * POST /api/admin/opportunities/find
 *   body: { regions: Region[] }
 *
 * Live-scrapes B2B lab-grown diamond buyers in the chosen regions via
 * OpenAI's web search tool, persists them, and returns the list.
 * No seed fallback — if the scrape fails, returns 502.
 */

import { NextResponse } from 'next/server';
import { requireLoggedInAdmin } from '@/lib/adminGuard';
import { hasPermission } from '@/lib/permissions';
import { scrapeOpportunities, ALL_REGIONS, type Region } from '@/lib/opportunities/scrape';
import { getAll, upsertMany } from '@/lib/opportunities/store';

export async function POST(req: Request) {
  const guard = await requireLoggedInAdmin(req);
  if (!guard.ok) return guard.response;
  if (!hasPermission(guard.admin as any, 'ai_briefing', 'view')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: { regions?: Region[] } = {};
  try { body = await req.json(); } catch { /* fall back to all */ }
  const regions = (body.regions && body.regions.length > 0)
    ? body.regions.filter(r => ALL_REGIONS.includes(r))
    : ALL_REGIONS;

  // Preserve any in-flight opportunities — keep pursued/sent records, only
  // overwrite `new` ones with fresh scrape data.
  const existing = await getAll();
  const byId = new Map(existing.map(o => [o.id, o]));

  let scraped: Awaited<ReturnType<typeof scrapeOpportunities>>;
  try {
    scraped = await scrapeOpportunities(regions);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'web search failed' },
      { status: 502 },
    );
  }

  const toUpsert = scraped.filter(s => {
    const cur = byId.get(s.id);
    return !cur || cur.status === 'new';
  });
  await upsertMany(toUpsert);

  const merged = scraped.map(s => byId.get(s.id) ?? s);
  merged.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

  return NextResponse.json({
    regions,
    count: merged.length,
    opportunities: merged,
  });
}
