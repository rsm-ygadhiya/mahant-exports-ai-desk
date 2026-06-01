/**
 * Tiny JSON-file-backed store for Opportunity Finder state.
 *
 * Keeping this out of Prisma on purpose — opportunities are a demo
 * workflow, not a system of record, and Prisma migrations are heavier
 * than this feature needs. State lives under ui/web/.opp-state.json.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export type EnrichedOpportunity = {
  id: string;
  company: string;
  region: string;
  segment: string;
  portal_url?: string;
  reported_demand: string;
  // LLM-enriched
  fit_summary: string;
  contact_role: string;
  contact_email?: string;     // best-effort role-based address inferred by Claude
  confidence: number;        // 0-100
  // Workflow state
  status: 'new' | 'draft' | 'pursuing' | 'sent' | 'discarded';
  // Set every time the lead is surfaced by a Find run. Helps drafts show "last seen".
  run_at?: string;
  // Filled when pursued
  portal_form?: PortalForm;
  email_draft?: EmailDraft;
  sent_at?: string;
  discarded_at?: string;
  notes?: string;
  // Source article URL when the lead came from a scraped news headline
  source_url?: string;
};

export type PortalForm = {
  company_name: string;
  founded: string;
  hq: string;
  certifications: string;
  inventory_summary: string;
  unique_value: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
};

export type EmailDraft = {
  to: string;
  to_role: string;
  subject: string;
  body: string;
};

type State = {
  opportunities: Record<string, EnrichedOpportunity>;
};

const STATE_PATH = path.join(process.cwd(), '.opp-state.json');

async function load(): Promise<State> {
  if (!existsSync(STATE_PATH)) {
    return { opportunities: {} };
  }
  try {
    const text = await readFile(STATE_PATH, 'utf8');
    return JSON.parse(text);
  } catch {
    return { opportunities: {} };
  }
}

async function save(state: State): Promise<void> {
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

export async function getAll(): Promise<EnrichedOpportunity[]> {
  const s = await load();
  return Object.values(s.opportunities);
}

export async function getOne(id: string): Promise<EnrichedOpportunity | null> {
  const s = await load();
  return s.opportunities[id] ?? null;
}

export async function upsertMany(items: EnrichedOpportunity[]): Promise<void> {
  const s = await load();
  for (const it of items) s.opportunities[it.id] = it;
  await save(s);
}

export async function update(id: string, patch: Partial<EnrichedOpportunity>): Promise<EnrichedOpportunity | null> {
  const s = await load();
  const cur = s.opportunities[id];
  if (!cur) return null;
  const next = { ...cur, ...patch };
  s.opportunities[id] = next;
  await save(s);
  return next;
}

export async function clear(): Promise<void> {
  await save({ opportunities: {} });
}

/**
 * Move all currently-`new` leads to `draft`. Called at the start of each
 * Find run so the previous batch is preserved as historical drafts and the
 * fresh scrape can claim the `new` slot on its own.
 */
export async function archiveCurrentNewToDrafts(): Promise<number> {
  const s = await load();
  let moved = 0;
  for (const id of Object.keys(s.opportunities)) {
    if (s.opportunities[id].status === 'new') {
      s.opportunities[id] = { ...s.opportunities[id], status: 'draft' };
      moved++;
    }
  }
  if (moved > 0) await save(s);
  return moved;
}
