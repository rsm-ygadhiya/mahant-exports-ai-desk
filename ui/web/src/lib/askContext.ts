// Builds the RAG context for the Ask AI tool.
// Pulls a live snapshot from Prisma + the latest autopilot CSV outputs
// (clv_tiers, memo_decisions, triage_decisions) so Claude can answer
// questions like "who has the highest CLV", "what's stale on memo",
// "which categories are understocked".

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from './db';

const DEFAULT_M3_REPO =
  '/Users/lucifer/Desktop/MSBA/Spring/Gen AI/mgt449-milestone03-Group-10';

function workingDir(): string {
  const repo = process.env.M3_REPO_PATH || DEFAULT_M3_REPO;
  return path.join(repo, 'data', 'working');
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.length > 0);
  if (lines.length === 0) return [];
  const header = splitLine(lines[0]);
  return lines.slice(1).map(line => {
    const cells = splitLine(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    return row;
  });
}
function splitLine(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

async function readWorkingCsv(name: string): Promise<Record<string, string>[]> {
  try {
    const text = await readFile(path.join(workingDir(), name), 'utf8');
    return parseCsv(text);
  } catch { return []; }
}

/**
 * Build a compact, structured RAG block. Designed to fit comfortably under a
 * standard context window — top-N slices only, with concrete IDs the model
 * can quote back.
 */
export async function buildDeskContext(): Promise<string> {
  const now = Date.now();
  const D = 86_400_000;
  const sevenDaysAgo = new Date(now - 7 * D);

  // ── Live Prisma snapshot ────────────────────────────────────────────────
  const [
    available, hold, sold, pendingCustomers, totalCustomers,
    newEnquiries, allEnquiries,
    valueAvail, staleMemos,
    topByEnquiry,
  ] = await Promise.all([
    prisma.diamond.count({ where: { status: 'AVAILABLE' } }),
    prisma.diamond.count({ where: { status: 'HOLD' } }),
    prisma.diamond.count({ where: { status: 'SOLD' } }),
    prisma.customer.count({ where: { status: 'PENDING' } }),
    prisma.customer.count(),
    prisma.enquiry.count({ where: { status: 'NEW' } }),
    prisma.enquiry.count(),
    prisma.diamond.aggregate({ where: { status: 'AVAILABLE' }, _sum: { totalPrice: true } }),
    prisma.diamond.findMany({
      where: { status: 'HOLD', updatedAt: { lt: sevenDaysAgo } },
      orderBy: { updatedAt: 'asc' }, take: 10,
      select: { id: true, stoneId: true, shape: true, carat: true, color: true, clarity: true, totalPrice: true, updatedAt: true },
    }),
    prisma.customer.findMany({
      where: { status: 'APPROVED' },
      include: { enquiries: { include: { items: true } } },
      take: 200,
    }),
  ]);

  const topByValue = topByEnquiry
    .map(c => {
      const total = c.enquiries.reduce(
        (s, eq) => s + eq.items.reduce((s2, it) => s2 + Number(it.totalPrice ?? 0), 0), 0);
      return { id: c.id, name: c.companyName, country: c.country ?? '-', enquiries: c.enquiries.length, totalEnquiryValue: Math.round(total) };
    })
    .sort((a, b) => b.totalEnquiryValue - a.totalEnquiryValue)
    .slice(0, 10);

  // ── Diamonds by shape (top categories) ─────────────────────────────────
  const byShape = await prisma.diamond.groupBy({
    by: ['shape'], where: { status: 'AVAILABLE' },
    _count: { _all: true }, _sum: { totalPrice: true },
  });
  const shapeLines = byShape
    .map(g => ({ shape: g.shape, n: g._count._all, value: Number(g._sum.totalPrice ?? 0) }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 10);

  // ── Autopilot CSV outputs (CLV tiers, memo decisions, triage) ──────────
  const [clvRows, memoRows, triageRows] = await Promise.all([
    readWorkingCsv('clv_tiers.csv'),
    readWorkingCsv('memo_decisions.csv'),
    readWorkingCsv('triage_decisions.csv'),
  ]);

  const topCLV = clvRows
    .map(r => ({
      entity_id: r.entity_id, entity_name: r.entity_name,
      level: r.level, tier: r.tier, clv: Number(r.clv) || 0,
      transactions: r.transactions,
    }))
    .sort((a, b) => b.clv - a.clv)
    .slice(0, 15);

  const memoCounts = memoRows.reduce<Record<string, number>>((acc, r) => {
    const k = r.queue || 'unknown'; acc[k] = (acc[k] ?? 0) + 1; return acc;
  }, {});
  const memoNeedsReview = memoRows
    .filter(r => r.queue === 'needs_review')
    .slice(0, 10)
    .map(r => ({ memo_id: r.memo_id, customer_id: r.customer_id, stock_id: r.stock_id, tier: r.tier, reason: r.route_reason }));

  const triageCounts = triageRows.reduce<Record<string, number>>((acc, r) => {
    const k = r.action_tag || 'unknown'; acc[k] = (acc[k] ?? 0) + 1; return acc;
  }, {});

  // ── Assemble ───────────────────────────────────────────────────────────
  const lines: string[] = [];

  // Project-specific knowledge — the actual rules, weights, and thresholds
  // every Mahant tool uses. This is what makes answers Mahant-specific
  // instead of generic industry talk. Numbers here are SOURCE OF TRUTH.
  lines.push('=== HOW THE MAHANT DESK ACTUALLY WORKS (with the real numbers) ===');
  lines.push('');
  lines.push('Scintilla autopilot — four chained steps:');
  lines.push('  1) Triage Inventory  → tags every available stone HOLD / WATCH / DISCOUNT / CLEAR.');
  lines.push('  2) Propose Repricing → recomputes $/ct for every stone using 15 factors.');
  lines.push('  3) Rank Customer CLV → scores every broker + company, cuts into Top/High/Mid/Low quartiles.');
  lines.push('  4) Decide Memo       → routes each pending memo into auto_approve / needs_review / auto_reject.');
  lines.push('Each step writes a CSV to data/working/ that the UI renders on the Scintilla page.');
  lines.push('');
  lines.push('==== 1. Inventory Aging Triage ====');
  lines.push('Tags each available stone using age + category velocity + demand signal + active inquiries:');
  lines.push('  • HOLD     — young (<60d) or in an active category → leave alone.');
  lines.push('  • WATCH    — mid-age, mixed signals → monitor next week.');
  lines.push('  • DISCOUNT — old but category still has demand → drop price to capture remaining interest.');
  lines.push('  • CLEAR    — old + weak category → push out aggressively (clearance queue).');
  lines.push('Feeds the repricing step (DISCOUNT/CLEAR pull prices down) and the memo gate.');
  lines.push('');
  lines.push('==== 2. Weekly Repricing — the 15 factors (REAL WEIGHTS) ====');
  lines.push('Each factor adjusts the stone’s $/ct relative to the new Rap anchor:');
  lines.push('  F1  New Rap rate         — base = carat × rap_per_carat × (1 − discount).');
  lines.push('  F2  Position preference  — rank_1 = −3%; page_1 = 0%; page_2 = +2%.');
  lines.push('  F3  Aging triage tag     — CLEAR = −5%; DISCOUNT = −3%; HOLD/WATCH = 0%.');
  lines.push('  F4  Age in stock         — 90–179d = −3%; ≥180d = −6%.');
  lines.push('  F5  Category velocity    — 0 sales in 60d = −2%; ≥5 sales in 60d = +1%.');
  lines.push('  F6  Demand score         — demand_score < 0.40 = −2%; ≥ 0.60 = +1%.');
  lines.push('  F7  Realized sales comps — drives the velocity signal in F5.');
  lines.push('  F8  Marketplace depth    — ≥150 comparable listings = −1% (crowded).');
  lines.push('  F9  Margin floor         — HARD CAP: never below cost_basis × 1.05 (5% min margin), or whatever --min-margin is set to. Breach = MARGIN flag.');
  lines.push('  F10 Cost basis           — used for the margin % calculation.');
  lines.push('  F11 Active memos         — stone on memo → frozen (proposed = old price, FROZEN flag).');
  lines.push('  F12 In-flight quotes     — if proposed < open quote price → QUOTE flag (caught by a live quote).');
  lines.push('  F13 Inventory depth      — subsumed in F8.');
  lines.push('  F14 Customer-specific deals — deferred (not in current pipeline).');
  lines.push('  F15 FX adjustments       — deferred (not in current pipeline).');
  lines.push('Flags on each proposal: UNCHANGED (|Δ| ≤ 0.5%, info only) · FROZEN (memo) · MARGIN (capped at floor) · QUOTE (open quote).');
  lines.push('Auto-vs-review split: AUTO-APPLIED when |Δ| ≤ 7% and no unsafe flag; NEEDS APPROVAL otherwise.');
  lines.push('Margin labels on each row: Safe (≥ min_margin) · Conditional (capped at floor) · Unsafe (floor below cost, data anomaly).');
  lines.push('');
  lines.push('==== 3. CLV (Customer Lifetime Value) ====');
  lines.push('Discounted cash-flow over a horizon, computed from REAL sales (not enquiry value):');
  lines.push('  CLV = Σ_{m=0..H-1} monthly_profit × retention^(m+1) / (1 + r)^(m+1)');
  lines.push('Inputs:');
  lines.push('  • monthly_profit  = sum(gross_profit) / months_active   (gross_profit already nets cost).');
  lines.push('  • retention       = 1 − (churn_risk_pct / 100)          (from customers_seed.csv).');
  lines.push('  • r (discount)    = 0.008 / month (0.8%/mo, ≈10%/yr); overridable.');
  lines.push('  • H (horizon)     = 36 months default; overridable to 48.');
  lines.push('  • months_active   = (today − first_sale) / 30.44, min 1.');
  lines.push('Levels: company (end-buyer) and broker (rolls up all companies under that broker + broker’s direct buys).');
  lines.push('Filter: entities with fewer than 1 transaction are excluded.');
  lines.push('Quartile tiering after ranking: Top = top 25% · High = next 25% · Mid = next 25% · Low = bottom 25%.');
  lines.push('Caveats to flag: <3 transactions = noisy; negative monthly_profit = near-zero or negative CLV.');
  lines.push('');
  lines.push('==== 4. Memo Approval (FIFO + HITL gate) ====');
  lines.push('Precedence (first matching rule wins):');
  lines.push('  R1 customer already RECEIVED this stone on a prior memo → auto_reject (duplicate).');
  lines.push('  R2 stone currently HELD by a DIFFERENT customer (prior approved, not closed) → auto_reject (taken).');
  lines.push('  R3 requester is Mid-tier CLV AND has >1 pending stone request right now → needs_review (the ONLY human case).');
  lines.push('  R4 FIFO: earliest pending request for the stone (by request_date timestamp) → auto_approve.');
  lines.push('  R5 Any later request for the same stone after R4 → auto_reject (allocated to earlier).');
  lines.push('No more reliability/opportunity scoring — replaced by FIFO + the mid-CLV-multi rule.');
  lines.push('');
  lines.push('==== 5. Quote Negotiation (decisions + headroom) ====');
  lines.push('Decision rules:');
  lines.push('  • Deal value > $50,000                                   → ESCALATE.');
  lines.push('  • No customer counter yet                                → HOLD at current offer.');
  lines.push('  • Customer offer ≥ our asking price                      → ACCEPT.');
  lines.push('  • Customer offer ≥ max concession price (within headroom)→ ACCEPT.');
  lines.push('  • Customer offer ≥ floor price (above floor, below headroom) → COUNTER at max concession.');
  lines.push('  • Customer offer < floor price                           → WALK_AWAY.');
  lines.push('Price anatomy: asking_price → offered_price → max_concession (= offered × (1 − headroom)) → floor_price = cost_basis × 1.08 (8% min margin for negotiations).');
  lines.push('Discount headroom by CLV tier:');
  lines.push('  • Top    = 5.0% additional headroom off current offer.');
  lines.push('  • High   = 3.0%.');
  lines.push('  • Mid    = 1.5%.');
  lines.push('  • Low/New = 0.5%.');
  lines.push('Adjustments stacked on headroom:');
  lines.push('  • High demand (score ≥ 0.65): −1% headroom (stone is hot).');
  lines.push('  • Low demand  (score < 0.35): +1% headroom (move slow movers).');
  lines.push('  • High churn risk (> 30%):    +0.5% headroom (retain customer).');
  lines.push('');
  lines.push('==== 6. Collection Reminders (skill version, by days-past-due) ====');
  lines.push('Bucket thresholds (skill, from the invoice ledger):');
  lines.push('  • Upcoming  : −5 to 0 days past due  → friendly heads-up.');
  lines.push('  • Just Due  : 1–7  days past due     → polite nudge.');
  lines.push('  • Aging     : 8–30 days past due     → firm reminder.');
  lines.push('  • Overdue   : 31–60 days past due    → escalation.');
  lines.push('  • Critical  : 60+  days past due     → urgent, flag for management.');
  lines.push('Invoices more than 5 days before due are silently excluded.');
  lines.push('UI Collections (Mahant web app, days-SINCE-SOLD proxy because no invoice ledger):');
  lines.push('  • Just Due 30–45 · Aging 45–60 · Overdue 60–90 · Critical 90+. Tone enum: FRIENDLY/FIRM/ESCALATED.');
  lines.push('Stones older than 30d sold are surfaced; older first.');
  lines.push('');
  lines.push('==== 7. Demand Forecast & Sourcing Gaps ====');
  lines.push('Compares forecast demand per category vs current available inventory.');
  lines.push('Outputs a coverage ratio (available / recommended) and a gap (recommended − available).');
  lines.push('Severity (skill): CRITICAL gap = biggest understock, NOTABLE = mid, MINOR = small.');
  lines.push('Visual: top-15 horizontal bar chart of gap; scatter of coverage_ratio vs demand_score sized by gap.');
  lines.push('Use as upstream sourcing intel — what to buy more of.');
  lines.push('');
  lines.push('==== 8. Negotiation Threads ====');
  lines.push('Summarises the comm log on each open negotiation thread.');
  lines.push('Tags status: OPEN · STALLED (no movement) · WARM (recent activity) · CLOSED_WON · CLOSED_LOST.');
  lines.push('A thread is "neglected" when last activity > 7 days.');
  lines.push('LLM (skill) reads notes/messages and writes a 2-sentence summary + recommended next action.');
  lines.push('');
  lines.push('==== 9. Morning Briefing ====');
  lines.push('Pulls stock counts, unactioned enquiries, pending customer signups, stale memos (>7d), recent sales.');
  lines.push('Priorities by severity: HIGH (revenue at risk: stale memos, new enquiries, pending signups) · MEDIUM (inventory health, follow-ups) · LOW (nice-to-haves).');
  lines.push('Each card carries a deep link to the relevant page and the top 3 specific rows (memo IDs, enquiry IDs, customer IDs).');
  lines.push('');
  lines.push('==== Customer pricing layer (storefront) ====');
  lines.push('Each customer has a pricingRule.mode applied AFTER the repricing step produces the base $/ct:');
  lines.push('  • BASE        → customer sees the system price as-is.');
  lines.push('  • ADJUST_PCT  → applies a per-customer ± percentage (negotiated terms).');
  lines.push('  • HIDDEN      → price hidden, must enquire (broker/reseller layer — prevents back-calculating your margin).');
  lines.push('');
  lines.push('==== Ask AI (this tool) ====');
  lines.push('RAG over the Prisma DB + the Scintilla CSV outputs, answered by Claude via TritonAI (UCSD proxy).');
  lines.push('Always grounds answers in the project rules above when relevant.');
  lines.push('');
  lines.push('=== DATA DICTIONARY (short) ===');
  lines.push('Diamond: stoneId, shape, carat, color (D-Z), clarity (FL..I3), cut/polish/symmetry (EX..F), lab (IGI/GIA/GCAL/HRD/SGL), pricePerCarat ($/ct), totalPrice ($), status (NOT_LIVE/AVAILABLE/HOLD/SOLD).');
  lines.push('Customer: companyName, country, status (PENDING/APPROVED/REJECTED), pricingRule.mode (BASE/HIDDEN).');
  lines.push('Enquiry: status (NEW/CONTACTED/QUOTED/APPROVED_MEMO/CLOSED), items[] with diamondId+totalPrice.');
  lines.push('CLV tier (canonical, project-wide): Top / High / Mid / Low by CLV quartile.');
  lines.push('Memo queue: auto_approve | needs_review | auto_reject (FIFO + mid-CLV-multi review).');
  lines.push('Triage tag: HOLD | WATCH | DISCOUNT | CLEAR.');
  lines.push('');
  lines.push('=== LIVE DESK SNAPSHOT (Prisma) ===');
  lines.push(`Stock: ${available} available · ${hold} on memo · ${sold} sold.`);
  lines.push(`Available inventory value: $${Number(valueAvail._sum.totalPrice ?? 0).toLocaleString()}.`);
  lines.push(`Customers: ${totalCustomers} total · ${pendingCustomers} pending approval.`);
  lines.push(`Enquiries: ${newEnquiries} new · ${allEnquiries} all-time.`);
  lines.push('');
  lines.push('Available stock by shape (top 10):');
  for (const s of shapeLines) lines.push(`  ${s.shape}: ${s.n} stones, $${s.value.toLocaleString()}`);
  lines.push('');
  lines.push('Top 10 approved customers by total enquiry value:');
  for (const c of topByValue) lines.push(`  ${c.id} | ${c.name} (${c.country}) — ${c.enquiries} enquiries, ~$${c.totalEnquiryValue.toLocaleString()}`);
  lines.push('');
  lines.push('Stale memos (>7 days, oldest first, top 10):');
  for (const d of staleMemos) {
    const days = Math.floor((now - d.updatedAt.getTime()) / D);
    lines.push(`  ${d.stoneId} (${d.shape} ${Number(d.carat).toFixed(2)}ct ${d.color}/${d.clarity}, $${Number(d.totalPrice).toFixed(0)}) — on memo ${days}d`);
  }
  lines.push('');
  lines.push('=== AUTOPILOT SNAPSHOT (data/working/*.csv) ===');
  if (clvRows.length === 0) {
    lines.push('(no clv_tiers.csv yet — run Scintilla to produce it)');
  } else {
    lines.push(`CLV ranked entities: ${clvRows.length}. Top 15 by CLV:`);
    for (const c of topCLV) {
      lines.push(`  ${c.entity_id} | ${c.entity_name} (${c.level}, ${c.tier}) — CLV $${Math.round(c.clv).toLocaleString()} from ${c.transactions} transactions`);
    }
  }
  lines.push('');
  if (memoRows.length === 0) {
    lines.push('(no memo_decisions.csv yet)');
  } else {
    const parts = Object.entries(memoCounts).map(([k, v]) => `${k}=${v}`).join(' · ');
    lines.push(`Memo decisions: ${parts}.`);
    if (memoNeedsReview.length > 0) {
      lines.push('Needs human review (top 10):');
      for (const m of memoNeedsReview) {
        lines.push(`  ${m.memo_id} | ${m.customer_id} → ${m.stock_id} (tier ${m.tier}) — ${m.reason}`);
      }
    }
  }
  lines.push('');
  if (triageRows.length === 0) {
    lines.push('(no triage_decisions.csv yet)');
  } else {
    const parts = Object.entries(triageCounts).map(([k, v]) => `${k}=${v}`).join(' · ');
    lines.push(`Triage tags: ${parts}.`);
  }

  return lines.join('\n');
}
