// Rule-based versions of every AI skill — no LLM calls, runs instantly.
// Useful when the OpenAI key isn't configured yet, for offline review,
// and as a sanity-check baseline against the AI output.
//
// Each function returns the SAME shape as its AI counterpart so the
// existing pages render them identically.

import { prisma } from '@/lib/db';
import type { TriageResult, TriageTag } from './agingTriage';
import type { BriefingResult } from './morningBriefing';
import type { ForecastResult } from './demandForecast';
import type { RepricingResult } from './weeklyRepricing';
import type { NegotiationResponse } from './quoteNegotiation';
import type { MemoReview, MemoDecision } from './memoApproval';
import type { CLVResult, CustomerCLV } from './clvAnalysis';
import type { CollectionResult, Bucket } from './collectionReminder';
import type { ThreadsResult, ThreadSummary } from './negotiationThreads';

const D = 86_400_000; // ms in a day

// ───────────────────────── 1. AGING TRIAGE ─────────────────────────

export async function heuristicAgingTriage(): Promise<TriageResult> {
  const stones = await prisma.diamond.findMany({
    where: { status: 'AVAILABLE' },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  const now = Date.now();
  const items = stones.map(s => {
    const days = Math.floor((now - s.createdAt.getTime()) / D);
    const existingDisc = Number(s.discountPct ?? 0);
    let tag: TriageTag = 'HOLD';
    let suggestedDiscountPct: number | undefined;
    let reason = '';

    if (days >= 90) {
      tag = 'CLEAR'; suggestedDiscountPct = -15;
      reason = `${days} days in stock — well past clearance threshold.`;
    } else if (days >= 60) {
      tag = 'DISCOUNT'; suggestedDiscountPct = -8;
      reason = `${days} days in stock — slow mover, suggest moderate discount.`;
    } else if (days >= 30) {
      tag = 'WATCH'; suggestedDiscountPct = undefined;
      reason = `${days} days in stock — borderline; revisit in a week.`;
    } else {
      tag = 'HOLD'; suggestedDiscountPct = undefined;
      reason = `${days} days in stock — fresh, hold price.`;
    }
    // Already heavily discounted? Push toward CLEAR.
    if (existingDisc <= -15 && tag !== 'CLEAR') {
      tag = 'CLEAR'; suggestedDiscountPct = -5;
      reason = `Already at ${existingDisc.toFixed(1)}% off — try one more cut and clear.`;
    }
    return { stoneId: s.stoneId, tag, reason, suggestedDiscountPct };
  });

  const counts = { HOLD: 0, WATCH: 0, DISCOUNT: 0, CLEAR: 0 } as Record<TriageTag, number>;
  for (const it of items) counts[it.tag]++;

  const summary = `${stones.length} available stones reviewed. ${counts.HOLD} HOLD · ${counts.WATCH} WATCH · ${counts.DISCOUNT} DISCOUNT · ${counts.CLEAR} CLEAR. Heuristic basis: age in stock + existing discount %. Use AI mode for demand-aware triage.`;

  return { items, summary };
}

// ───────────────────────── 2. MORNING BRIEFING ─────────────────────────

export async function heuristicMorningBriefing(): Promise<BriefingResult> {
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * D);
  const [
    available, hold, sold,
    pendingCustomers, newEnquiries, staleMemoCount,
    staleMemoRows, newEnquiryRows, pendingCustomerRows,
  ] = await Promise.all([
    prisma.diamond.count({ where: { status: 'AVAILABLE' } }),
    prisma.diamond.count({ where: { status: 'HOLD' } }),
    prisma.diamond.count({ where: { status: 'SOLD' } }),
    prisma.customer.count({ where: { status: 'PENDING' } }),
    prisma.enquiry.count({ where: { status: 'NEW' } }),
    prisma.diamond.count({ where: { status: 'HOLD', updatedAt: { lt: sevenDaysAgo } } }),
    prisma.diamond.findMany({
      where: { status: 'HOLD', updatedAt: { lt: sevenDaysAgo } },
      orderBy: { updatedAt: 'asc' }, take: 3,
      select: { id: true, stoneId: true, carat: true, color: true, clarity: true, shape: true, updatedAt: true },
    }),
    prisma.enquiry.findMany({
      where: { status: 'NEW' },
      orderBy: { createdAt: 'desc' }, take: 3,
      include: { customer: { select: { companyName: true } }, items: { select: { totalPrice: true } } },
    }),
    prisma.customer.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' }, take: 3,
      select: { id: true, companyName: true },
    }),
  ]);

  const days = (d: Date) => Math.floor((now - d.getTime()) / D);
  const top: BriefingResult['topPriorities'] = [];
  if (newEnquiries > 0) {
    top.push({
      priority: 'HIGH', category: 'Enquiries',
      action: `Respond to ${newEnquiries} new enquir${newEnquiries === 1 ? 'y' : 'ies'}.`,
      context: 'Buyers are waiting. Each unactioned enquiry is a stalled deal.',
      href: '/admin/enquiries',
      details: newEnquiryRows.map(eq => ({
        label: `${eq.customer.companyName} · ${eq.items.length} stone${eq.items.length === 1 ? '' : 's'} · ${days(eq.createdAt)}d ago`,
        href: `/admin/enquiries/${eq.id}`,
      })),
    });
  }
  if (staleMemoCount > 0) {
    top.push({
      priority: 'HIGH', category: 'Stale memos',
      action: `Review ${staleMemoCount} memo${staleMemoCount === 1 ? '' : 's'} held >7 days.`,
      context: 'Long holds tie up valuable inventory. Convert or release.',
      href: '/admin/memo',
      details: staleMemoRows.map(d => ({
        label: `${d.stoneId} · ${d.shape} ${Number(d.carat).toFixed(2)}ct ${d.color}/${d.clarity} · ${days(d.updatedAt)}d on memo`,
        href: `/admin/diamonds/${d.id}`,
      })),
    });
  }
  if (pendingCustomers > 0) {
    top.push({
      priority: 'MEDIUM', category: 'Customer approvals',
      action: `Approve or reject ${pendingCustomers} pending customer signup${pendingCustomers === 1 ? '' : 's'}.`,
      context: 'New buyers see no prices until approved. Quick turnaround keeps leads warm.',
      href: '/admin/customers',
      details: pendingCustomerRows.map(c => ({
        label: c.companyName,
        href: `/admin/customers/${c.id}`,
      })),
    });
  }

  const radar: BriefingResult['alsoOnRadar'] = [
    {
      priority: 'LOW', category: 'Inventory health',
      action: 'Run aging triage on available stock.',
      context: `${available} stones currently available.`,
      href: '/admin/ai/aging',
    },
    {
      priority: 'LOW', category: 'Sales pulse',
      action: 'Review sold / memo conversion this week.',
      context: `${sold} sold all-time · ${hold} on memo right now.`,
      href: '/admin/sold',
    },
  ];

  return {
    greeting: `Good morning. Here's where the desk stands today.`,
    topPriorities: top.length ? top : [{
      priority: 'LOW', category: 'Quiet morning',
      action: 'Nothing urgent on deck.',
      context: 'No new enquiries, no stale memos, no pending approvals. Use the time for sourcing.',
      href: '/admin/diamonds',
    }],
    alsoOnRadar: radar,
    summary: `${newEnquiries} enquir${newEnquiries === 1 ? 'y' : 'ies'} pending · ${staleMemoCount} stale memo${staleMemoCount === 1 ? '' : 's'} · ${pendingCustomers} pending customer${pendingCustomers === 1 ? '' : 's'}. Click any card to drill in.`,
  };
}

// ───────────────────────── 3. DEMAND FORECAST ─────────────────────────

function caratBand(c: number): string {
  if (c < 0.5) return '<0.5ct';
  if (c < 1.0) return '0.5-1.0ct';
  if (c < 1.5) return '1.0-1.5ct';
  if (c < 2.0) return '1.5-2.0ct';
  if (c < 3.0) return '2.0-3.0ct';
  return '3.0ct+';
}

export async function heuristicDemandForecast(): Promise<ForecastResult> {
  const stones = await prisma.diamond.findMany({
    where: { status: 'AVAILABLE' },
    select: { shape: true, carat: true, clarity: true },
  });
  const since = new Date(Date.now() - 60 * D);
  const enqItems = await prisma.enquiryItem.findMany({
    where: { enquiry: { createdAt: { gte: since } } },
    include: { diamond: { select: { shape: true, carat: true, clarity: true } } },
  });
  const k = (sh: string, c: number, cl: string) => `${sh} · ${caratBand(c)} · ${cl}`;
  const supply = new Map<string, number>();
  const demand = new Map<string, number>();
  for (const s of stones) supply.set(k(s.shape, Number(s.carat), s.clarity), (supply.get(k(s.shape, Number(s.carat), s.clarity)) ?? 0) + 1);
  for (const it of enqItems) {
    const key = k(it.diamond.shape, Number(it.diamond.carat), it.diamond.clarity);
    demand.set(key, (demand.get(key) ?? 0) + 1);
  }
  const all = new Set([...supply.keys(), ...demand.keys()]);
  const gaps: ForecastResult['gaps'] = [];
  const surpluses: ForecastResult['surpluses'] = [];
  for (const cat of all) {
    const sup = supply.get(cat) ?? 0;
    const dem = demand.get(cat) ?? 0;
    const ratio = dem / Math.max(1, sup);
    if (dem >= 2 && sup === 0) {
      gaps.push({ category: cat, severity: 'CRITICAL', reason: `${dem} enquiries, zero stock.`, recommendation: 'Source urgently.' });
    } else if (dem >= 3 && ratio > 1.5) {
      gaps.push({ category: cat, severity: 'NOTABLE', reason: `${dem} enquiries vs ${sup} in stock.`, recommendation: 'Add to next sourcing run.' });
    } else if (sup >= 5 && dem === 0) {
      surpluses.push({ category: cat, severity: 'NOTABLE', reason: `${sup} in stock, no enquiries in 60 days.`, recommendation: 'Slow buys; consider clearance.' });
    } else if (sup >= 10 && ratio < 0.2) {
      surpluses.push({ category: cat, severity: 'MINOR', reason: `${sup} in stock, only ${dem} enquiries.`, recommendation: 'Pause buys until demand catches up.' });
    }
  }
  gaps.sort((a, b) => (a.severity === 'CRITICAL' ? -1 : 1));
  return {
    gaps: gaps.slice(0, 8),
    surpluses: surpluses.slice(0, 5),
    summary: `Heuristic basis: enquiry-vs-stock count by shape × carat band × clarity. Gaps where demand ≥ 2 and supply is thin; surpluses where stock ≥ 5 with low enquiry count over the last 60 days. Use AI mode for nuanced category groupings and language.`,
  };
}

// ───────────────────────── 4. WEEKLY REPRICING ─────────────────────────

export async function heuristicWeeklyRepricing(): Promise<RepricingResult> {
  const stones = await prisma.diamond.findMany({ where: { status: 'AVAILABLE' }, orderBy: { createdAt: 'asc' }, take: 150 });
  const now = Date.now();
  let changes = 0; let totalDrop = 0;
  const items = stones.map(s => {
    const days = Math.floor((now - s.createdAt.getTime()) / D);
    const existingDisc = Number(s.discountPct ?? 0);
    let pctChange = 0;
    let reason = 'No change — fresh stock.';
    if (days >= 90)      { pctChange = -10; reason = `${days}d old — clearance push.`; }
    else if (days >= 60) { pctChange = -5;  reason = `${days}d old — moderate discount.`; }
    else if (days >= 45) { pctChange = -3;  reason = `${days}d old — small reduction.`; }
    else if (days >= 30) { pctChange = -1;  reason = `${days}d old — token cut.`; }
    if (existingDisc <= -15 && pctChange < 0) { pctChange = Math.max(pctChange, -3); reason = `Already discounted ${existingDisc.toFixed(1)}% — softer cut.`; }
    const oldPpc = Number(s.pricePerCarat);
    const newPpc = pctChange === 0 ? oldPpc : Math.round(oldPpc * (1 + pctChange / 100) / 5) * 5;
    if (newPpc !== oldPpc) { changes++; totalDrop += pctChange; }
    return { stoneId: s.stoneId, oldPpc, newPpc, changePct: pctChange, reason };
  });
  const avgDrop = changes ? totalDrop / changes : 0;
  return {
    items,
    summary: `${changes} of ${stones.length} stones repriced. Average move: ${avgDrop.toFixed(1)}%. Heuristic basis: age-based discount curve (30/45/60/90d steps), softened for already-discounted stones, rounded to $5.`,
  };
}

// ───────────────────────── 5. QUOTE NEGOTIATION ─────────────────────────

export async function heuristicQuoteNegotiation(): Promise<{ responses: NegotiationResponse[]; summary: string }> {
  const enquiries = await prisma.enquiry.findMany({
    where: { status: { in: ['NEW', 'CONTACTED'] } },
    include: { customer: { include: { pricingRule: true } }, items: { include: { diamond: true } } },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  const now = Date.now();
  const responses: NegotiationResponse[] = enquiries.map(eq => {
    const days = Math.floor((now - eq.createdAt.getTime()) / D);
    const isHidden = eq.customer.pricingRule?.mode === 'HIDDEN';
    const stones = eq.items.length;
    const totalValue = eq.items.reduce((s, it) => s + Number(it.totalPrice ?? 0), 0);
    const oldestStoneAge = Math.max(...eq.items.map(it => Math.floor((now - it.diamond.createdAt.getTime()) / D)), 0);

    let decision: NegotiationResponse['decision'] = 'COUNTER';
    let counterPpc: number | undefined;
    let reasoning: string;
    if (isHidden || totalValue >= 50_000) {
      decision = 'ESCALATE';
      reasoning = `${isHidden ? 'Hidden-tier customer' : 'High-ticket'} ($${Math.round(totalValue).toLocaleString()}) — owner should handle.`;
    } else if (oldestStoneAge >= 60) {
      decision = 'COUNTER';
      const avgPpc = eq.items.reduce((s, it) => s + Number(it.diamond.pricePerCarat), 0) / Math.max(1, eq.items.length);
      counterPpc = Math.round(avgPpc * 0.95 / 5) * 5;
      reasoning = `Stones avg ${oldestStoneAge}d old — there's room to come down 5%.`;
    } else if (days >= 7) {
      decision = 'HOLD';
      reasoning = `${days}d since enquiry, stones still fresh — hold price, offer alternatives.`;
    } else {
      decision = 'COUNTER';
      const avgPpc = eq.items.reduce((s, it) => s + Number(it.diamond.pricePerCarat), 0) / Math.max(1, eq.items.length);
      counterPpc = Math.round(avgPpc * 0.97 / 5) * 5;
      reasoning = `Recent enquiry, modest counter at -3%.`;
    }
    const stoneList = eq.items.map(it => `${it.diamond.stoneId} (${it.diamond.shape} ${Number(it.diamond.carat).toFixed(2)}ct)`).join(', ');
    const draftReply = decision === 'ESCALATE'
      ? `Hello ${eq.customer.contactPerson},\n\nThanks for your enquiry on ${stoneList}. Our director will reach out personally within 24h with a tailored quote.\n\nBest,\nMahant Exports`
      : decision === 'HOLD'
      ? `Hello ${eq.customer.contactPerson},\n\nThanks for the enquiry on ${stoneList}. The current $/ct stands as quoted. We'd be happy to suggest comparable alternatives at different price points if helpful.\n\nBest,\nMahant Exports`
      : `Hello ${eq.customer.contactPerson},\n\nThanks for the enquiry on ${stoneList}. We can do $${counterPpc}/ct on ${stones === 1 ? 'this stone' : 'these stones'}. Let us know if that works.\n\nBest,\nMahant Exports`;

    return {
      enquiryId: eq.id,
      customerName: eq.customer.companyName,
      decision,
      counterPpc,
      reasoning,
      draftReply,
    };
  });

  return {
    responses,
    summary: `${responses.length} open enquir${responses.length === 1 ? 'y' : 'ies'} reviewed. Heuristic basis: ESCALATE for high-value (>$50k) or hidden-tier customers, COUNTER -5% for stones >60d old, HOLD for fresh stones >7d quiet, COUNTER -3% otherwise. Drafted replies use templates.`,
  };
}

// ───────────────────────── 6. MEMO APPROVAL ─────────────────────────

export async function heuristicMemoApproval(): Promise<{ reviews: MemoReview[]; summary: string }> {
  const stones = await prisma.diamond.findMany({ where: { status: 'HOLD' }, orderBy: { updatedAt: 'asc' }, take: 50 });
  const enqItems = await prisma.enquiryItem.findMany({
    where: { diamondId: { in: stones.map(s => s.id) } },
    include: { enquiry: { include: { customer: true } } },
    orderBy: { enquiry: { createdAt: 'desc' } },
  });
  const stoneToCustomer = new Map<string, { name: string; status: string }>();
  for (const it of enqItems) {
    if (!stoneToCustomer.has(it.diamondId)) {
      stoneToCustomer.set(it.diamondId, {
        name: it.enquiry.customer.companyName,
        status: it.enquiry.customer.status,
      });
    }
  }

  // Multi-stone signal: how many stones each customer is currently holding.
  const holdCount = new Map<string, number>();
  for (const s of stones) {
    const name = stoneToCustomer.get(s.id)?.name ?? 'Unknown';
    holdCount.set(name, (holdCount.get(name) ?? 0) + 1);
  }

  const now = Date.now();
  const reviews: MemoReview[] = stones.map(s => {
    const days = Math.floor((now - s.updatedAt.getTime()) / D);
    const cust = stoneToCustomer.get(s.id);
    const name = cust?.name ?? 'Unknown';
    const held = holdCount.get(name) ?? 1;

    let decision: MemoReview['decision'];
    let conditions: string | null = null;
    let reasoning: string;

    // Precedence: AUTO_REJECT → NEEDS_REVIEW → AUTO_APPROVE.
    if (days >= 30) {
      decision = 'AUTO_REJECT';
      conditions = 'Release back to AVAILABLE.';
      reasoning = `Held ${days} days — well past the memo window.`;
    } else if (cust && cust.status !== 'APPROVED') {
      decision = 'AUTO_REJECT';
      conditions = 'Release — holder is not an approved buyer.';
      reasoning = `Holder is ${cust.status.toLowerCase()}; unapproved customers shouldn't tie up stock.`;
    } else if (held > 1) {
      decision = 'NEEDS_REVIEW';
      conditions = `Decide which of ${held} held stones to keep.`;
      reasoning = `${name} is holding ${held} stones at once — needs desk sign-off.`;
    } else if (days >= 14) {
      decision = 'NEEDS_REVIEW';
      conditions = 'Confirm intent or release.';
      reasoning = `Held ${days} days — ageing memo, worth a check.`;
    } else {
      decision = 'AUTO_APPROVE';
      reasoning = `Held ${days} days, single stone — healthy memo.`;
    }
    return { stoneId: s.stoneId, customerName: name, decision, conditions, reasoning };
  });

  const n = (d: MemoDecision) => reviews.filter(r => r.decision === d).length;
  return {
    reviews,
    summary: `${stones.length} memo${stones.length === 1 ? '' : 's'} reviewed — ✅ ${n('AUTO_APPROVE')} keep · ⚠ ${n('NEEDS_REVIEW')} review · ❌ ${n('AUTO_REJECT')} release. Heuristic basis: release if >30d or unapproved holder; review if holder has multiple stones or held 14d+; keep otherwise. AI mode adds CLV nuance.`,
  };
}

// ───────────────────────── 7. CLV ANALYSIS ─────────────────────────

export async function heuristicCLVAnalysis(): Promise<CLVResult> {
  const customers = await prisma.customer.findMany({
    where: { status: 'APPROVED' },
    include: { pricingRule: true, enquiries: { include: { items: true } } },
    take: 100,
  });
  const now = Date.now();
  const scored: CustomerCLV[] = customers.map(c => {
    const totalValue = c.enquiries.reduce((s, eq) => s + eq.items.reduce((s2, it) => s2 + Number(it.totalPrice ?? 0), 0), 0);
    const lastEnq = c.enquiries[0]?.createdAt;
    const daysSince = lastEnq ? Math.floor((now - lastEnq.getTime()) / D) : 999;
    const conv = c.enquiries.length === 0 ? 0.05 : c.enquiries.length >= 5 ? 0.30 : 0.15;
    const repeatFactor = c.enquiries.length >= 10 ? 3 : c.enquiries.length >= 5 ? 2 : 1.2;
    const estimatedCLV = Math.round(totalValue * conv * repeatFactor);
    return {
      customerId: c.id,
      companyName: c.companyName,
      estimatedCLV,
      enquiryCount: c.enquiries.length,
      conversionEstimate: `${Math.round(conv * 100)}%`,
      tier: 'Low',
      recommendation: '',
      _daysSince: daysSince,
    } as CustomerCLV & { _daysSince: number };
  });
  scored.sort((a, b) => b.estimatedCLV - a.estimatedCLV);
  const total = scored.length;
  // Canonical CLV quartiles — Top / High / Mid / Low — matching the CLV skill
  // and the autopilot (rank-customer-clv), so every screen buckets the same way.
  scored.forEach((c, i) => {
    if (i < total / 4) c.tier = 'Top';
    else if (i < total / 2) c.tier = 'High';
    else if (i < (total * 3) / 4) c.tier = 'Mid';
    else c.tier = 'Low';
    const ds = (c as any)._daysSince as number;
    c.recommendation = c.tier === 'Top'
      ? `White-glove service. Reach out personally${ds > 30 ? ' — gone quiet for ' + ds + ' days' : ''}.`
      : c.tier === 'High'
      ? `Proactive sourcing on next high-value lots${ds > 60 ? ' — quiet for ' + ds + 'd' : ''}.`
      : c.tier === 'Mid' ? `Standard service — keep on regular new-arrival blasts.`
      : `Low touch — include in monthly newsletter only.`;
  });
  const top = scored.filter(c => c.tier === 'Top' || c.tier === 'High').slice(0, 10);
  const atRisk = scored.filter(c => (c as any)._daysSince > 60 && (c.tier === 'Top' || c.tier === 'High')).slice(0, 5);
  // Strip private prop before returning.
  const clean = (c: any) => ({ customerId: c.customerId, companyName: c.companyName, estimatedCLV: c.estimatedCLV, enquiryCount: c.enquiryCount, conversionEstimate: c.conversionEstimate, tier: c.tier, recommendation: c.recommendation });
  return {
    topCustomers: top.map(clean),
    atRisk: atRisk.map(clean),
    summary: `${total} approved customer${total === 1 ? '' : 's'} ranked by estimated CLV. Heuristic basis: total enquiry value × estimated conversion rate (5–30% based on activity) × repeat factor (1.2–3×). Quartiles → Top / High / Mid / Low.`,
  };
}

// ───────────────────────── 8. COLLECTION REMINDERS ─────────────────────────

export async function heuristicCollectionReminders(): Promise<CollectionResult> {
  const cutoff = new Date(Date.now() - 30 * D);
  const sold = await prisma.diamond.findMany({ where: { status: 'SOLD', updatedAt: { lt: cutoff } }, orderBy: { updatedAt: 'asc' }, take: 50 });
  const enqItems = await prisma.enquiryItem.findMany({
    where: { diamondId: { in: sold.map(s => s.id) } },
    include: { enquiry: { include: { customer: true } } },
    orderBy: { enquiry: { createdAt: 'desc' } },
  });
  const stoneToCustomer = new Map<string, string>();
  for (const it of enqItems) if (!stoneToCustomer.has(it.diamondId)) stoneToCustomer.set(it.diamondId, it.enquiry.customer.companyName);

  const now = Date.now();
  const reminders = sold.map(d => {
    const days = Math.floor((now - d.updatedAt.getTime()) / D);
    const cust = stoneToCustomer.get(d.id) ?? 'Unknown buyer';
    const amount = Number(d.totalPrice);
    let bucket: Bucket; let tone: 'FRIENDLY' | 'FIRM' | 'ESCALATED';
    if (days >= 90) { bucket = 'CRITICAL'; tone = 'ESCALATED'; }
    else if (days >= 60) { bucket = 'OVERDUE'; tone = 'ESCALATED'; }
    else if (days >= 45) { bucket = 'AGING'; tone = 'FIRM'; }
    else { bucket = 'JUST_DUE'; tone = 'FRIENDLY'; }
    const certLine = d.certificateNo ? `${d.lab ?? ''} ${d.certificateNo}` : d.stoneId;
    const draftMessage = bucket === 'CRITICAL'
      ? `Dear ${cust},\n\nOur records show invoice for ${certLine} ($${amount.toFixed(0)}) is now ${days} days outstanding. We need to resolve this urgently — please reach out today.\n\nMahant Exports`
      : bucket === 'OVERDUE'
      ? `Dear ${cust},\n\nThis is a follow-up regarding the unpaid invoice for ${certLine} ($${amount.toFixed(0)}), now ${days} days past sale. Please confirm payment status this week.\n\nMahant Exports`
      : bucket === 'AGING'
      ? `Hello ${cust},\n\nA quick reminder that the invoice for ${certLine} ($${amount.toFixed(0)}) is ${days} days out. Could you confirm when payment will land?\n\nThanks,\nMahant Exports`
      : `Hi ${cust},\n\nFriendly nudge — the invoice for ${certLine} ($${amount.toFixed(0)}) is approaching due date (${days}d since sale, Net 30 terms). Let us know if you need anything.\n\nMahant Exports`;
    return { customerName: cust, stoneId: d.stoneId, amount, daysSinceSold: days, bucket, draftMessage, tone };
  });
  return {
    reminders,
    summary: `${reminders.length} sale${reminders.length === 1 ? '' : 's'} aged ≥30 days — buckets: ${reminders.filter(r => r.bucket === 'JUST_DUE').length} just due, ${reminders.filter(r => r.bucket === 'AGING').length} aging, ${reminders.filter(r => r.bucket === 'OVERDUE').length} overdue, ${reminders.filter(r => r.bucket === 'CRITICAL').length} critical. Heuristic uses templates by bucket; AI mode personalizes language.`,
  };
}

// ───────────────────────── 9. NEGOTIATION THREADS ─────────────────────────

export async function heuristicNegotiationThreads(): Promise<ThreadsResult> {
  const enquiries = await prisma.enquiry.findMany({
    include: { customer: true, items: { include: { diamond: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const now = Date.now();
  const threads: ThreadSummary[] = enquiries.map(eq => {
    const days = Math.floor((now - eq.createdAt.getTime()) / D);
    let status: ThreadSummary['status'];
    let nextAction: string;
    if (eq.status === 'CLOSED') {
      status = 'CLOSED_WON'; // we don't track won/lost — assume won for now
      nextAction = 'Closed — no action.';
    } else if (eq.status === 'CONTACTED') {
      if (days >= 7) { status = 'STALLED'; nextAction = 'Re-engage — no movement in a week.'; }
      else { status = 'WARM'; nextAction = 'Wait for buyer response, follow up by day 5.'; }
    } else { // NEW
      if (days >= 5) { status = 'STALLED'; nextAction = 'Send first response immediately.'; }
      else if (days >= 2) { status = 'OPEN'; nextAction = 'Respond today.'; }
      else { status = 'WARM'; nextAction = 'Acknowledge and quote.'; }
    }
    const stones = eq.items.length;
    const total = eq.items.reduce((s, it) => s + Number(it.totalPrice ?? 0), 0);
    const oneLineSummary = `${eq.customer.companyName} interested in ${stones} stone${stones === 1 ? '' : 's'} (~$${Math.round(total).toLocaleString()}); status ${eq.status}.`;
    return { enquiryId: eq.id, customerName: eq.customer.companyName, status, daysSinceLastTouch: days, oneLineSummary, nextAction };
  });
  const stalled = threads.filter(t => t.status === 'STALLED').length;
  return {
    threads,
    summary: `${threads.length} thread${threads.length === 1 ? '' : 's'} reviewed · ${stalled} stalled. Heuristic basis: enquiry status × days since creation. AI mode reads buyer notes and customizes recommendations.`,
  };
}
