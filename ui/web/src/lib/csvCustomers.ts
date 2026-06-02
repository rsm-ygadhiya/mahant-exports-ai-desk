/**
 * CSV-backed CLV customer loader.
 *
 * The CLV analytics in this project run on the seed CSVs in `data/raw/`,
 * not the Prisma `Customer` table (which only tracks login/KYC accounts).
 * This module gives the admin UI direct read access to those CSVs so the
 * /admin/customers page can show the 100 CLV-tracked accounts with their
 * order history and payment history.
 *
 * Resolution order for the CSV directory:
 *   1. process.env.M3_REPO_PATH  (set in .env when the analytics repo is elsewhere)
 *   2. <repo-root>/data/raw      (this repo, when the CSVs live alongside the UI)
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_RAW_DIR = path.resolve(process.cwd(), '..', '..', 'data', 'raw');

function candidateDirs(): string[] {
  const out: string[] = [];
  const env = process.env.M3_REPO_PATH;
  if (env) out.push(path.join(env, 'data', 'raw'));
  out.push(DEFAULT_RAW_DIR);
  return out;
}

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

async function loadCsv(filename: string): Promise<Record<string, string>[]> {
  for (const dir of candidateDirs()) {
    try {
      const text = await readFile(path.join(dir, filename), 'utf8');
      const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.length > 0);
      if (lines.length === 0) continue;
      const header = splitCsvLine(lines[0]);
      return lines.slice(1).map(line => {
        const cells = splitCsvLine(line);
        const row: Record<string, string> = {};
        header.forEach((h, i) => { row[h] = cells[i] ?? ''; });
        return row;
      });
    } catch {
      // Try the next candidate dir.
    }
  }
  return [];
}

const n = (v: string | undefined) => {
  if (!v || v.trim() === '') return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export type ClvCustomer = {
  customer_id: string;
  customer_name: string;
  is_broker: boolean;
  broker_id: string;
  customer_type: string;
  market: string;
  join_date: string;
  relationship_owner: string;
  payment_terms_days: number;
  payment_terms: string;
  payment_score: number;
  active_status: string;
  annual_spend: number;
  avg_order_value: number;
  purchase_frequency: number;
  gross_margin_pct: number;
  account_lifespan_years: number;
  churn_risk_pct: number;
  raw_clv: number;
  risk_adjusted_clv: number;
  clv_tier: string;          // raw CSV tier label (Diamond / Gold / etc.)
};

export type Transaction = {
  transaction_id: string;
  transaction_date: string;
  stock_id: string;
  category_simple: string;
  customer_id: string;
  broker_id: string;
  sold_price: number;
  sold_ppc: number;
  cost_at_sale: number;
  gross_profit: number;
  discount_pct: number;
  sales_channel: string;
  destination_market: string;
  payment_status: string;
  invoice_id: string;
  invoice_date: string;
  payment_terms_days: number;
  due_date: string;
};

export type Payment = {
  payment_id: string;
  invoice_id: string;
  customer_id: string;
  order_id: string;
  invoice_date: string;
  due_date: string;
  payment_date: string;
  payment_amount: number;
  terms_type: string;
  days_early_late: number;
  payment_behavior_label: string;
  late_incident_flag: string;
  month_bucket: string;
};

function toCustomer(r: Record<string, string>): ClvCustomer {
  return {
    customer_id: r.customer_id,
    customer_name: r.customer_name,
    is_broker: String(r.is_broker).toLowerCase() === 'true',
    broker_id: r.broker_id,
    customer_type: r.customer_type,
    market: r.market,
    join_date: r.join_date,
    relationship_owner: r.relationship_owner,
    payment_terms_days: n(r.payment_terms_days),
    payment_terms: r.payment_terms,
    payment_score: n(r.payment_score),
    active_status: r.active_status,
    annual_spend: n(r.annual_spend),
    avg_order_value: n(r.avg_order_value),
    purchase_frequency: n(r.purchase_frequency),
    gross_margin_pct: n(r.gross_margin_pct),
    account_lifespan_years: n(r.account_lifespan_years),
    churn_risk_pct: n(r.churn_risk_pct),
    raw_clv: n(r.raw_clv),
    risk_adjusted_clv: n(r.risk_adjusted_clv),
    clv_tier: r.clv_tier,
  };
}

function toTxn(r: Record<string, string>): Transaction {
  return {
    transaction_id: r.transaction_id,
    transaction_date: r.transaction_date,
    stock_id: r.stock_id,
    category_simple: r.category_simple,
    customer_id: r.customer_id,
    broker_id: r.broker_id,
    sold_price: n(r.sold_price),
    sold_ppc: n(r.sold_ppc),
    cost_at_sale: n(r.cost_at_sale),
    gross_profit: n(r.gross_profit),
    discount_pct: n(r.discount_pct),
    sales_channel: r.sales_channel,
    destination_market: r.destination_market,
    payment_status: r.payment_status,
    invoice_id: r.invoice_id,
    invoice_date: r.invoice_date,
    payment_terms_days: n(r.payment_terms_days),
    due_date: r.due_date,
  };
}

function toPayment(r: Record<string, string>): Payment {
  return {
    payment_id: r.payment_id,
    invoice_id: r.invoice_id,
    customer_id: r.customer_id,
    order_id: r.order_id,
    invoice_date: r.invoice_date,
    due_date: r.due_date,
    payment_date: r.payment_date,
    payment_amount: n(r.payment_amount),
    terms_type: r.terms_type,
    days_early_late: n(r.days_early_late),
    payment_behavior_label: r.payment_behavior_label,
    late_incident_flag: r.late_incident_flag,
    month_bucket: r.month_bucket,
  };
}

/** Canonical 4-tier CLV labels (Top / High / Mid / Low) by risk-adjusted CLV quartile.
 *  Matches the convention used by automations/rank-customer-clv. The raw CSV `clv_tier`
 *  field uses the older Diamond/Gold/... labels; we re-bucket so everything reads the same. */
export type CanonicalTier = 'Top' | 'High' | 'Mid' | 'Low';

export function quartileTier(rank: number, total: number): CanonicalTier {
  if (total <= 0) return 'Low';
  const pct = rank / total;
  if (pct <= 0.25) return 'Top';
  if (pct <= 0.50) return 'High';
  if (pct <= 0.75) return 'Mid';
  return 'Low';
}

export type CustomerWithTier = ClvCustomer & { tier: CanonicalTier };

export async function getAllCustomers(): Promise<CustomerWithTier[]> {
  const rows = (await loadCsv('customers_seed.csv')).map(toCustomer);
  // Rank by risk-adjusted CLV desc, then assign quartile tier.
  const sorted = [...rows].sort((a, b) => b.risk_adjusted_clv - a.risk_adjusted_clv);
  return sorted.map((c, i) => ({ ...c, tier: quartileTier(i + 1, sorted.length) }));
}

export async function getCustomer(customerId: string): Promise<CustomerWithTier | null> {
  const all = await getAllCustomers();
  return all.find(c => c.customer_id === customerId) ?? null;
}

export async function getCustomerTransactions(customerId: string): Promise<Transaction[]> {
  const rows = (await loadCsv('sales_transactions_seed.csv')).map(toTxn);
  // Match either as the buyer OR as the broker (so brokers see brokered deals too).
  return rows
    .filter(t => t.customer_id === customerId || t.broker_id === customerId)
    .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));
}

export async function getCustomerPayments(customerId: string): Promise<Payment[]> {
  const rows = (await loadCsv('payment_history_seed.csv')).map(toPayment);
  return rows
    .filter(p => p.customer_id === customerId)
    .sort((a, b) => (b.payment_date || b.invoice_date).localeCompare(a.payment_date || a.invoice_date));
}
