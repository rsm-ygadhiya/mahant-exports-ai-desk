/**
 * POST /api/admin/opportunities/find-stream
 *   body: { regions: Region[] }
 *
 * Same as /find but streams NDJSON progress events as the scrape runs,
 * so the UI can render a live activity log instead of a 15-second spinner.
 *
 * Event shapes:
 *   { type: 'progress', event: ProgressEvent }
 *   { type: 'result',   opportunities: EnrichedOpportunity[] }
 *   { type: 'error',    error: string }
 */

import { requireLoggedInAdmin } from '@/lib/adminGuard';
import { hasPermission } from '@/lib/permissions';
import { scrapeOpportunities, ALL_REGIONS, type Region, type ProgressEvent } from '@/lib/opportunities/scrape';
import { archiveCurrentNewToDrafts, getAll, upsertMany } from '@/lib/opportunities/store';

export async function POST(req: Request) {
  const guard = await requireLoggedInAdmin(req);
  if (!guard.ok) return guard.response;
  if (!hasPermission(guard.admin as any, 'ai_briefing', 'view')) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403, headers: { 'content-type': 'application/json' },
    });
  }

  let body: { regions?: Region[] } = {};
  try { body = await req.json(); } catch { /* fall back to all */ }
  const regions = (body.regions && body.regions.length > 0)
    ? body.regions.filter(r => ALL_REGIONS.includes(r))
    : ALL_REGIONS;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: any) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      };

      const onProgress = (event: ProgressEvent) => send({ type: 'progress', event });

      try {
        // 1. Archive last run's untouched leads as drafts so this run starts fresh.
        const archived = await archiveCurrentNewToDrafts();
        if (archived > 0) {
          send({ type: 'progress', event: { type: 'archived', count: archived } });
        }

        const existing = await getAll();
        const byId = new Map(existing.map(o => [o.id, o]));

        const scraped = await scrapeOpportunities(regions, onProgress);

        const runAt = new Date().toISOString();
        // For any id we already have in `pursuing`/`sent`, keep that — don't
        // reset progress just because the same company surfaced again.
        const toUpsert = scraped
          .filter(s => {
            const cur = byId.get(s.id);
            return !cur || cur.status === 'new' || cur.status === 'draft';
          })
          .map(s => ({ ...s, run_at: runAt }));
        await upsertMany(toUpsert);

        // The page's "current run" view = items just stamped with this runAt.
        const merged = scraped.map(s => {
          const cur = byId.get(s.id);
          // Pursued/sent companies keep their progress but get the fresh fit data.
          if (cur && (cur.status === 'pursuing' || cur.status === 'sent')) {
            return { ...cur, fit_summary: s.fit_summary, reported_demand: s.reported_demand, confidence: s.confidence, run_at: runAt };
          }
          return { ...s, run_at: runAt };
        });
        merged.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

        send({ type: 'result', opportunities: merged });
      } catch (e: any) {
        send({ type: 'error', error: e?.message ?? 'scrape failed' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
