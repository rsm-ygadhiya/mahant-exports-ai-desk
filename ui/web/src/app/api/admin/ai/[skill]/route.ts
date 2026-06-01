import { NextResponse } from 'next/server';
import { requireLoggedInAdmin } from '@/lib/adminGuard';
import { hasPermission, type ModuleKey } from '@/lib/permissions';
import { AI_AVAILABLE } from '@/lib/ai';

// Map each AI skill slug to the permission module that gates it. Each module
// can be view'd (nav visibility) and run (execution) — this dispatcher checks
// `run`. The Owner can grant/revoke either via /admin/team.
const SKILL_PERMISSION: Record<string, ModuleKey> = {
  briefing:    'ai_briefing',
  aging:       'ai_aging',
  demand:      'ai_demand',
  quote:       'ai_quote',
  memo:        'ai_memo',
  clv:         'ai_clv',
  threads:     'ai_threads',
  collections: 'ai_collections',
};

// AI versions
import { runAgingTriage } from '@/lib/ai-skills/agingTriage';
import { runMorningBriefing } from '@/lib/ai-skills/morningBriefing';
import { runDemandForecast } from '@/lib/ai-skills/demandForecast';
import { runWeeklyRepricing, applyRepricing, type RepricingResult } from '@/lib/ai-skills/weeklyRepricing';
import { runQuoteNegotiation } from '@/lib/ai-skills/quoteNegotiation';
import { runMemoApproval } from '@/lib/ai-skills/memoApproval';
import { runCLVAnalysis } from '@/lib/ai-skills/clvAnalysis';
import { runCollectionReminders } from '@/lib/ai-skills/collectionReminder';
import { runNegotiationThreads } from '@/lib/ai-skills/negotiationThreads';

// Heuristic (no-AI) versions — same return shape, no API key needed
import {
  heuristicAgingTriage, heuristicMorningBriefing, heuristicDemandForecast,
  heuristicWeeklyRepricing, heuristicQuoteNegotiation, heuristicMemoApproval,
  heuristicCLVAnalysis, heuristicCollectionReminders, heuristicNegotiationThreads,
} from '@/lib/ai-skills/heuristics';

const AI_SKILLS: Record<string, () => Promise<any>> = {
  aging: runAgingTriage,
  briefing: runMorningBriefing,
  demand: runDemandForecast,
  pricing: runWeeklyRepricing,
  quote: runQuoteNegotiation,
  memo: runMemoApproval,
  clv: runCLVAnalysis,
  collections: runCollectionReminders,
  threads: runNegotiationThreads,
};

const HEURISTIC_SKILLS: Record<string, () => Promise<any>> = {
  aging: heuristicAgingTriage,
  briefing: heuristicMorningBriefing,
  demand: heuristicDemandForecast,
  pricing: heuristicWeeklyRepricing,
  quote: heuristicQuoteNegotiation,
  memo: heuristicMemoApproval,
  clv: heuristicCLVAnalysis,
  collections: heuristicCollectionReminders,
  threads: heuristicNegotiationThreads,
};

/**
 * POST /api/admin/ai/<skill>?mode=ai|heuristic
 *
 * - mode=ai (default) : calls OpenAI GPT-4o. Requires OPENAI_API_KEY.
 * - mode=heuristic    : rule-based version. Runs locally and instantly. No API key needed.
 */
export async function POST(req: Request, { params }: { params: { skill: string } }) {
  const guard = await requireLoggedInAdmin(req);
  if (!guard.ok) return guard.response;

  // Per-tool permission gate. Each tool has its own module key so the Owner
  // can grant/revoke run access per admin via /admin/team.
  const requiredModule = SKILL_PERMISSION[params.skill];
  if (requiredModule && !hasPermission(guard.admin as any, requiredModule, 'run')) {
    return NextResponse.json(
      { error: `forbidden — missing permission ${requiredModule}.run` },
      { status: 403 },
    );
  }

  // Special-case: applying a repricing requires a body with the result to commit.
  if (params.skill === 'pricing-apply') {
    const body = await req.json() as { result: RepricingResult };
    const updated = await applyRepricing(body.result);
    return NextResponse.json({ updated });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') === 'heuristic' ? 'heuristic' : 'ai';

  if (mode === 'ai' && !AI_AVAILABLE()) {
    return NextResponse.json({
      error: 'OPENAI_API_KEY is not configured. Add it to .env, or click "Run instantly (no AI)" to use the rule-based version.',
    }, { status: 503 });
  }

  const fn = (mode === 'ai' ? AI_SKILLS : HEURISTIC_SKILLS)[params.skill];
  if (!fn) return NextResponse.json({ error: `unknown skill: ${params.skill}` }, { status: 404 });

  try {
    const result = await fn();
    return NextResponse.json({ ...result, _mode: mode });
  } catch (e: any) {
    console.error(`[ai/${params.skill}] error`, e);
    return NextResponse.json({ error: e?.message ?? 'Skill failed' }, { status: 500 });
  }
}
