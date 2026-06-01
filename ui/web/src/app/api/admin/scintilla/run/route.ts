/**
 * POST /api/admin/m3-workflow/run
 *
 * Runs the Milestone-03 deterministic Python workflow with the threshold
 * knobs the user picked in the UI, then reads back the four
 * `*_decisions.csv` artifacts so the page can render each step's queue.
 *
 * Body (all optional):
 *   {
 *     today?:        string,    // "YYYY-MM-DD"
 *     thresholdPct?: number,    // |%-change| auto-apply cap for propose-repricing
 *     oppCeiling?:   number,    // opportunity_score ceiling for decide-memo auto
 *     autoTiers?:    string[],  // CLV tiers eligible for memo auto-approve
 *     scenario?:     string,    // optional scenario name to load before running
 *   }
 *
 * Response:
 *   {
 *     run_id:   string,
 *     today:    string,
 *     steps: [
 *       {
 *         name:           string,
 *         envelope:       <Envelope>,
 *         decisions:      Array<Record<string, string>>,  // rows of the step's CSV
 *         artifact:       string,                          // path under data/working
 *       },
 *       ...
 *     ],
 *     stderr?: string,
 *   }
 *
 * Requires the M03 repo to be importable from `M3_REPO_PATH` (env var) or
 * the default path below. Calls `uv run python scripts/orchestrator.py`.
 */

import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { requireLoggedInAdmin } from '@/lib/adminGuard';

const DEFAULT_M3_REPO =
  '/Users/lucifer/Desktop/MSBA/Spring/Gen AI/mgt449-milestone03-Group-10';

const STEP_ARTIFACT: Record<string, string> = {
  'triage-inventory':  'triage_decisions.csv',
  'propose-repricing': 'repricing_proposals.csv',
  'rank-customer-clv': 'clv_tiers.csv',
  'decide-memo':       'memo_decisions.csv',
};

type StepEnvelope = {
  status: string;
  skill_name: string;
  next_action?: string;
  review_required?: boolean;
  artifact_refs?: string[];
  outputs?: Record<string, unknown>;
  error?: unknown;
};

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    return row;
  });
}

// Tiny CSV splitter — handles quoted fields with commas inside.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (c === ',' && !inQuote) {
      out.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function runPython(repoPath: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('uv', ['run', 'python', 'scripts/orchestrator.py', ...args], {
      cwd: repoPath,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}

/** Extract the four pretty-printed JSON envelopes from the orchestrator's stdout. */
function parseStepEnvelopes(stdout: string): { name: string; envelope: StepEnvelope }[] {
  const out: { name: string; envelope: StepEnvelope }[] = [];
  const STEP_HEADER = /^--- step: ([\w-]+) ---$/gm;
  const sections: { name: string; start: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = STEP_HEADER.exec(stdout)) !== null) {
    sections.push({ name: m[1], start: m.index + m[0].length });
  }
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const next = sections[i + 1];
    const chunk = stdout.slice(section.start, next?.start);
    // Find the first '{' and matching closing '}' at brace depth 0
    const openIdx = chunk.indexOf('{');
    if (openIdx < 0) continue;
    let depth = 0;
    let closeIdx = -1;
    for (let k = openIdx; k < chunk.length; k++) {
      const c = chunk[k];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { closeIdx = k; break; }
      }
    }
    if (closeIdx < 0) continue;
    const json = chunk.slice(openIdx, closeIdx + 1);
    try {
      out.push({ name: section.name, envelope: JSON.parse(json) as StepEnvelope });
    } catch { /* skip malformed */ }
  }
  return out;
}

export async function POST(req: Request) {
  const guard = await requireLoggedInAdmin(req);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => ({})) as {
    today?: string; thresholdPct?: number; oppCeiling?: number;
    autoTiers?: string[]; scenario?: string;
  };

  const repoPath = process.env.M3_REPO_PATH || DEFAULT_M3_REPO;

  const args: string[] = [];
  if (body.today)         args.push('--today', body.today);
  if (typeof body.thresholdPct === 'number') args.push('--threshold-pct', String(body.thresholdPct));
  if (typeof body.oppCeiling === 'number')   args.push('--opp-ceiling', String(body.oppCeiling));
  if (body.autoTiers && body.autoTiers.length > 0) {
    args.push('--auto-tiers', body.autoTiers.join(','));
  }

  // Optional pre-load of a scenario
  if (body.scenario) {
    const load = await new Promise<number>((resolve) => {
      const c = spawn('python3', ['scripts/simulate/tick.py', '--load', body.scenario!], {
        cwd: repoPath, env: process.env,
      });
      c.on('close', code => resolve(code ?? -1));
      c.on('error', () => resolve(-1));
    });
    if (load !== 0) {
      return NextResponse.json(
        { error: `Failed to load scenario '${body.scenario}'.` },
        { status: 500 },
      );
    }
  }

  const { stdout, stderr, code } = await runPython(repoPath, args);
  if (code !== 0) {
    return NextResponse.json(
      { error: `orchestrator exited ${code}`, stderr: stderr.slice(-2000), stdout: stdout.slice(-2000) },
      { status: 500 },
    );
  }

  const envelopes = parseStepEnvelopes(stdout);

  // Pick up the run_id from the first line
  const runId = (stdout.match(/workflow_run_id=([\w-]+)/) ?? [])[1] ?? '';

  // Read each step's CSV artifact and bundle it
  const working = path.join(repoPath, 'data', 'working');
  const steps = await Promise.all(envelopes.map(async ({ name, envelope }) => {
    const fname = STEP_ARTIFACT[name];
    let decisions: Record<string, string>[] = [];
    let artifact = '';
    if (fname) {
      artifact = `working/${fname}`;
      try {
        const text = await readFile(path.join(working, fname), 'utf8');
        decisions = parseCsv(text);
      } catch { /* file may not exist if step errored */ }
    }
    return { name, envelope, decisions, artifact };
  }));

  return NextResponse.json({
    run_id: runId,
    today: body.today ?? new Date().toISOString().slice(0, 10),
    steps,
    stderr: stderr.trim() || undefined,
  });
}
