/**
 * POST /api/admin/ai/ask  { question: string }
 *
 * RAG-style Q&A over the live desk state. Builds a context block from Prisma
 * + the Scintilla autopilot's data/working CSVs (CLV tiers, memo decisions,
 * triage), then asks Claude (via TritonAI) to answer.
 *
 * Answers questions like:
 *   "who has the highest CLV?"          ← reads clv_tiers.csv
 *   "what's stale on memo right now?"   ← Prisma + memo_decisions.csv
 *   "which shape has the most stock?"   ← Prisma groupBy
 *   "what memos need my sign-off?"      ← memo_decisions.csv (needs_review)
 */

import { NextResponse } from 'next/server';
import { requireLoggedInAdmin } from '@/lib/adminGuard';
import { hasPermission } from '@/lib/permissions';
import { askClaude, TRITON_AVAILABLE } from '@/lib/tritonClaude';
import { buildDeskContext } from '@/lib/askContext';

const SYSTEM = `You are a chat assistant for the owner of Mahant Exports, a B2B lab-grown diamond wholesaler.

Talk like a person, not a document.

Hard rules on style:
- Plain English, conversational, short paragraphs (1–3 sentences each).
- NO markdown headings (no #, ##, ###).
- NO markdown tables. If you have a list of items, say it in a sentence or use
  simple dashes ("- ") at most.
- NO bold/italic asterisks. NO horizontal rules ("---"). NO code blocks.
- NO preamble ("Great question!", "Sure!"). Just start answering.
- Aim for the length of a Slack reply, not a wiki page. If the answer is
  one sentence, keep it one sentence.

What to actually answer:
- For specific data questions ("who has the highest CLV", "what's stale on memo"),
  pull straight from the snapshot below. Quote real IDs, names, $ amounts.
- For "how does X work" questions, LEAD WITH HOW MAHANT'S OWN TOOLS DO IT —
  there's a section called "HOW THE MAHANT DESK ACTUALLY WORKS" in the context
  that describes the Scintilla autopilot, the four chained steps, the 15-factor
  pricing model, the memo FIFO gate, the CLV quartile method, the triage tagger,
  etc. Describe that, in plain English, like you would to a new desk hire.
- Do NOT default to generic industry advice (e.g. "you'd usually work off Rap
  discount") unless the project's own logic genuinely doesn't address the
  question. The project IS the answer here. Only bring in outside industry
  context to compare or fill a gap, and say so when you do.

When you mention something specific from the data, just say it naturally —
"in your data, X" or "here you have Y" — no labelled callout blocks.`;

export async function POST(req: Request) {
  const guard = await requireLoggedInAdmin(req);
  if (!guard.ok) return guard.response;

  if (!hasPermission(guard.admin as any, 'ai_ask', 'run')) {
    return NextResponse.json(
      { error: 'forbidden — missing permission ai_ask.run' },
      { status: 403 },
    );
  }

  if (!TRITON_AVAILABLE()) {
    return NextResponse.json(
      { error: 'TRITONAI_API_KEY is not configured. Add it to ui/web/.env to enable Ask AI.' },
      { status: 503 },
    );
  }

  let body: { question?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json body' }, { status: 400 }); }

  const question = (body.question ?? '').trim();
  if (!question) return NextResponse.json({ error: 'question is required' }, { status: 400 });

  try {
    const cachedContext = await buildDeskContext();
    const { answer, usage } = await askClaude({
      system: SYSTEM,
      cachedContext,
      userMessage: question,
    });
    return NextResponse.json({ answer, usage });
  } catch (e: any) {
    console.error('[ai/ask] error', e);
    return NextResponse.json({ error: e?.message ?? 'ask failed' }, { status: 500 });
  }
}
