/**
 * Live opportunity scraper.
 *
 * Real scraping: fetches Google News RSS for each chosen region (no API key
 * needed, returns current real headlines + URLs), then hands the headlines
 * to Claude via TritonAI to extract structured B2B-buyer leads.
 *
 * No seed fallback. If the fetch or extraction fails, we throw — the route
 * surfaces that to the UI as an error.
 */

import { askClaude, TRITON_AVAILABLE } from '@/lib/tritonClaude';
import type { EnrichedOpportunity } from './store';

export type Region =
  | 'North America'
  | 'Europe'
  | 'India'
  | 'Middle East'
  | 'Asia-Pacific';

export const ALL_REGIONS: Region[] = [
  'North America', 'Europe', 'India', 'Middle East', 'Asia-Pacific',
];

// Google News RSS query per region. `hl/gl/ceid` localise results.
const REGION_QUERIES: Record<Region, { query: string; hl: string; gl: string; ceid: string }> = {
  'North America': { query: '"lab grown diamond" (supplier OR sourcing OR wholesale) (retailer OR jeweler OR jewellery)', hl: 'en-US', gl: 'US', ceid: 'US:en' },
  'Europe':        { query: '"lab grown diamond" (supplier OR sourcing OR wholesale) (UK OR Europe OR jeweller)',          hl: 'en-GB', gl: 'GB', ceid: 'GB:en' },
  'India':         { query: '"lab grown diamond" (supplier OR sourcing OR wholesale) (India OR Indian jeweller)',           hl: 'en-IN', gl: 'IN', ceid: 'IN:en' },
  'Middle East':   { query: '"lab grown diamond" (supplier OR sourcing OR wholesale) (UAE OR Dubai OR Saudi OR GCC)',       hl: 'en',    gl: 'AE', ceid: 'AE:en' },
  'Asia-Pacific':  { query: '"lab grown diamond" (supplier OR sourcing OR wholesale) (China OR HK OR Australia OR Japan)',  hl: 'en',    gl: 'SG', ceid: 'SG:en' },
};

function rssUrl(r: Region): string {
  const { query, hl, gl, ceid } = REGION_QUERIES[r];
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

type RawHeadline = {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  source: string;
  region: Region;
};

/** Crude XML scraper — Google News RSS items are simple enough that regex beats pulling in a parser. */
function parseRss(xml: string, region: Region): RawHeadline[] {
  const items: RawHeadline[] = [];
  // Match each <item>...</item>
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const grab = (tag: string) => {
      const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`).exec(block);
      if (!r) return '';
      return r[1]
        .replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')
        .replace(/<[^>]+>/g, ' ')        // strip nested HTML
        .replace(/\s+/g, ' ').trim();
    };
    const title = grab('title');
    const link = grab('link');
    if (!title || !link) continue;
    items.push({
      title,
      link,
      pubDate: grab('pubDate'),
      description: grab('description'),
      source: grab('source'),
      region,
    });
  }
  return items;
}

async function fetchRegionHeadlines(region: Region): Promise<RawHeadline[]> {
  const res = await fetch(rssUrl(region), {
    headers: { 'user-agent': 'Mozilla/5.0 (Mahant Opportunity Finder)' },
    // 12s ceiling — Google News is usually <2s but we don't want a hang
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Google News RSS ${region}: HTTP ${res.status}`);
  const xml = await res.text();
  return parseRss(xml, region);
}

const MAHANT_PROFILE = `Mahant Exports is a B2B lab-grown diamond wholesaler in Surat, India.
IGI- and GIA-certified LG stones from 0.30ct to 5.00ct, rounds/ovals/emeralds/princess/fancies,
VVS+ clarity in the bridal range. Supplies specialty jewelers, bridal chains, and online
marketplaces with weekly Rap-pegged pricing and direct-from-cutter margins.`;

const EXTRACT_SYSTEM = `You are a B2B sourcing analyst for Mahant Exports.

You will be given a batch of REAL news headlines + descriptions scraped from
Google News right now. Read them, identify companies that are actively buying,
sourcing, or expanding in lab-grown diamonds (retailers, jewelers, marketplaces,
bridal chains, department stores, luxury houses), and return a structured lead
list.

For each lead, return ONE JSON object on its own line with these fields:
  id              kebab-case slug from the company name (e.g. "blue-nile")
  company         official company name
  region          one of: North America | Europe | India | Middle East | Asia-Pacific
  segment         one of: Big-box retail | Specialty jeweler | Online marketplace | Department store | Bridal chain | Luxury house
  portal_url      public supplier/vendor portal URL if you can infer it confidently; omit field otherwise
  reported_demand 1 sentence quoting/paraphrasing what the headline says they are sourcing
  fit_summary     1-2 sentences on WHY they fit Mahant Exports
  contact_role    likely decision-maker title (e.g. "Director of Sourcing — Jewelry")
  confidence      integer 0-100; how confident this is a real, currently-active opportunity
  source_url      the news article URL that supports this lead

Rules:
  - Only include companies that the HEADLINES support — do NOT invent leads.
  - Skip headlines that are pure consumer marketing or trend pieces with no named buyer.
  - One JSON object per line. No array brackets, no markdown fences, no commentary.
  - Up to 12 leads total. If fewer headlines are buyer-related, return fewer.`;

type ParsedLead = {
  id: string;
  company: string;
  region: Region;
  segment: EnrichedOpportunity['segment'];
  portal_url?: string;
  reported_demand: string;
  fit_summary: string;
  contact_role: string;
  confidence: number;
  source_url?: string;
};

function parseLeads(text: string): ParsedLead[] {
  const out: ParsedLead[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      const j = JSON.parse(line);
      if (!j.id || !j.company || !j.region) continue;
      out.push({
        id: String(j.id),
        company: String(j.company),
        region: j.region as Region,
        segment: (j.segment ?? 'Specialty jeweler') as EnrichedOpportunity['segment'],
        portal_url: j.portal_url ? String(j.portal_url) : undefined,
        reported_demand: String(j.reported_demand ?? ''),
        fit_summary: String(j.fit_summary ?? ''),
        contact_role: String(j.contact_role ?? 'Sourcing Lead'),
        confidence: Math.max(0, Math.min(100, Number(j.confidence) || 50)),
        source_url: j.source_url ? String(j.source_url) : undefined,
      });
    } catch { /* skip malformed */ }
  }
  return out;
}

export type ProgressEvent =
  | { type: 'start'; regions: Region[] }
  | { type: 'archived'; count: number }
  | { type: 'fetch_begin'; region: Region; source: string }
  | { type: 'fetch_done'; region: Region; count: number; ms: number }
  | { type: 'fetch_fail'; region: Region; error: string }
  | { type: 'collected'; totalHeadlines: number }
  | { type: 'extract_begin'; sentTo: string; headlineCount: number }
  | { type: 'extract_done'; leadCount: number; ms: number }
  | { type: 'done'; leadCount: number };

/**
 * Live-scrape opportunities. Fetches Google News RSS for each region, hands
 * the headlines to Claude (via TritonAI) for extraction, returns leads.
 * Throws if no key is configured, fetches fail, or extraction yields nothing.
 *
 * `onProgress` (optional) is called for every visible milestone so the UI
 * can render a live activity log instead of a dead spinner.
 */
export async function scrapeOpportunities(
  regions: Region[],
  onProgress?: (e: ProgressEvent) => void,
): Promise<EnrichedOpportunity[]> {
  const emit = (e: ProgressEvent) => { try { onProgress?.(e); } catch { /* never break the scrape on a UI bug */ } };

  if (!TRITON_AVAILABLE()) {
    throw new Error('TRITONAI_API_KEY is not set — Opportunity Finder needs it to extract leads from scraped news.');
  }

  emit({ type: 'start', regions });

  // 1. Scrape headlines in parallel per region, emitting progress per region.
  const batches = await Promise.all(
    regions.map(async r => {
      emit({ type: 'fetch_begin', region: r, source: 'news.google.com' });
      const t0 = Date.now();
      try {
        const items = await fetchRegionHeadlines(r);
        emit({ type: 'fetch_done', region: r, count: items.length, ms: Date.now() - t0 });
        return items;
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        console.warn(`[opportunities] ${r} fetch failed:`, msg);
        emit({ type: 'fetch_fail', region: r, error: msg });
        return [] as RawHeadline[];
      }
    })
  );
  const headlines = batches.flat();
  emit({ type: 'collected', totalHeadlines: headlines.length });

  if (headlines.length === 0) {
    throw new Error('Google News returned no headlines for the chosen regions — try again or widen the selection.');
  }

  // 2. Feed headlines to Claude. Cap at ~60 to keep context tight.
  const trimmed = headlines.slice(0, 60);
  const userMessage = `Scraped headlines (${trimmed.length} items):\n\n` +
    trimmed.map((h, i) =>
      `[${i + 1}] (${h.region} · ${h.source})\n  ${h.title}\n  ${h.description}\n  ${h.link}`
    ).join('\n\n');

  emit({ type: 'extract_begin', sentTo: 'Claude (TritonAI)', headlineCount: trimmed.length });
  const t1 = Date.now();
  const { answer } = await askClaude({
    system: EXTRACT_SYSTEM,
    cachedContext: MAHANT_PROFILE,
    userMessage,
  });

  const leads = parseLeads(answer);
  emit({ type: 'extract_done', leadCount: leads.length, ms: Date.now() - t1 });

  if (leads.length === 0) {
    throw new Error('Claude found no buyer-named leads in the current headlines — try again later or pick different regions.');
  }

  // 3. Dedupe by id (Claude occasionally repeats).
  const byId = new Map<string, ParsedLead>();
  for (const l of leads) if (!byId.has(l.id)) byId.set(l.id, l);

  const out = Array.from(byId.values()).map(l => ({
    ...l,
    status: 'new' as const,
  }));
  emit({ type: 'done', leadCount: out.length });
  return out;
}
