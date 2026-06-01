/**
 * GET /api/admin/scintilla/memo/[memoId]
 *
 * Returns the rich detail for a single memo decision — joining the M3
 * memos / inventory / customers / payment-history CSVs plus the
 * Scintilla-written memo_decisions.csv (which has the deterministic
 * route_reason + rationale).
 *
 * Used by the MemoDetailModal in /admin/scintilla.
 *
 * Response shape:
 *   {
 *     memo:        { memo_id, request_date, ... },
 *     stone:       { stock_id, shape, carat, color, clarity, ppc, total, age, triage_tag, status, ... } | null,
 *     customer:    { customer_id, name, type, market, payment_terms, payment_score, churn_risk, annual_spend, clv_tier, ... } | null,
 *     broker:      same shape as customer, or null,
 *     decision:    { queue, decision, reliability_score, opportunity_score, route_reason, rationale } | null,
 *     conflicts:   Array<{ memo_id, customer_id, decision, request_date }>,
 *     recent_pays: Array<{ invoice_id, due_date, payment_date, days_early_late, payment_behavior_label }>,
 *   }
 */

import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { requireLoggedInAdmin } from '@/lib/adminGuard';

const DEFAULT_M3_REPO =
  '/Users/lucifer/Desktop/MSBA/Spring/Gen AI/mgt449-milestone03-Group-10';

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (c === ',' && !inQuote) { out.push(cur); cur = ''; }
    else { cur += c; }
  }
  out.push(cur);
  return out;
}

async function loadCsv(p: string): Promise<Record<string, string>[]> {
  try {
    const text = await readFile(p, 'utf8');
    const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.length > 0);
    if (lines.length === 0) return [];
    const header = splitCsvLine(lines[0]);
    return lines.slice(1).map(line => {
      const cells = splitCsvLine(line);
      const row: Record<string, string> = {};
      header.forEach((h, i) => { row[h] = cells[i] ?? ''; });
      return row;
    });
  } catch {
    return [];
  }
}

export async function GET(req: Request, { params }: { params: { memoId: string } }) {
  const guard = await requireLoggedInAdmin(req);
  if (!guard.ok) return guard.response;

  const memoId = params.memoId;
  const repo = process.env.M3_REPO_PATH || DEFAULT_M3_REPO;
  const raw = path.join(repo, 'data', 'raw');
  const working = path.join(repo, 'data', 'working');

  const [memos, inventory, customers, payments, decisions] = await Promise.all([
    loadCsv(path.join(raw,     'memos_seed.csv')),
    loadCsv(path.join(raw,     'inventory_seed.csv')),
    loadCsv(path.join(raw,     'customers_seed.csv')),
    loadCsv(path.join(raw,     'payment_history_seed.csv')),
    loadCsv(path.join(working, 'memo_decisions.csv')),
  ]);

  const memo = memos.find(m => m.memo_id === memoId);
  if (!memo) {
    return NextResponse.json({ error: `memo ${memoId} not found` }, { status: 404 });
  }

  // Stone
  const stone = inventory.find(s => s.stock_id === memo.stock_id) ?? null;

  // Customer + broker
  const customer = memo.customer_id ? customers.find(c => c.customer_id === memo.customer_id) ?? null : null;
  const broker   = memo.broker_id   ? customers.find(c => c.customer_id === memo.broker_id)   ?? null : null;

  // Scintilla's decision row (if the workflow has run since the last reset)
  const decision = decisions.find(d => d.memo_id === memoId) ?? null;

  // Other memos for the same stone (so the modal can show "currently held
  // by MEMOxxxxx" with full context, not just the route_reason text)
  const conflicts = memos
    .filter(m => m.stock_id === memo.stock_id && m.memo_id !== memoId)
    .map(m => ({
      memo_id:        m.memo_id,
      customer_id:    m.customer_id,
      decision:       m.decision,
      request_date:   m.request_date,
      closed_outcome: m.closed_outcome,
    }));

  // Customer's recent payment behaviour (top 5, latest first)
  const recent_pays = payments
    .filter(p => p.customer_id === memo.customer_id)
    .sort((a, b) => (b.payment_date ?? '').localeCompare(a.payment_date ?? ''))
    .slice(0, 5);

  return NextResponse.json({
    memo,
    stone,
    customer,
    broker,
    decision,
    conflicts,
    recent_pays,
  });
}
