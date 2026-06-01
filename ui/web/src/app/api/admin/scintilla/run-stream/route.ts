/**
 * POST /api/admin/scintilla/run-stream
 *
 * Streaming variant of /run — emits NDJSON lines as each Python step
 * actually starts and finishes, so the UI can show step cards
 * progressively rather than dumping everything at once.
 *
 * Event shape (one JSON object per line):
 *
 *   { "event": "run-start", "run_id": "wf-...", "today": "YYYY-MM-DD" }
 *   { "event": "step-start", "name": "triage-inventory" }
 *   { "event": "step-end",   "name": "triage-inventory",
 *     "envelope": {...}, "decisions": [...], "artifact": "working/..." }
 *   { "event": "step-error", "name": "...", "message": "..." }
 *   { "event": "run-end",    "review_required": bool }
 *
 * The non-streaming /run endpoint stays for clients that just want the
 * full bundle in one response.
 */

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

/**
 * Stateful line-by-line parser. Tracks `step-start` and `step-end`
 * markers, accumulates the JSON envelope lines between them, and
 * yields events as they complete.
 */
class StreamParser {
  private mode: 'idle' | 'capturing' = 'idle';
  private currentStep: string | null = null;
  private envelopeLines: string[] = [];

  events: { event: string; [k: string]: unknown }[] = [];

  feed(line: string) {
    const startMatch  = line.match(/^--- step-start: ([\w-]+) ---/);
    const endMatch    = line.match(/^--- step-end: ([\w-]+) ---/);
    const errorMatch  = line.match(/^❌ step ([\w-]+) failed/);
    const runIdMatch  = line.match(/workflow_run_id=([\w-]+)/);

    if (runIdMatch) {
      this.events.push({ event: 'run-start', run_id: runIdMatch[1] });
      return;
    }
    if (startMatch) {
      this.events.push({ event: 'step-start', name: startMatch[1] });
      // Now expect a JSON envelope from this step
      this.mode = 'capturing';
      this.currentStep = startMatch[1];
      this.envelopeLines = [];
      return;
    }
    if (endMatch && this.mode === 'capturing' && this.currentStep) {
      // Step finished — flush whatever envelope we managed to capture
      this.flushEnvelope();
      return;
    }
    if (errorMatch) {
      this.events.push({ event: 'step-error', name: errorMatch[1], message: line.trim() });
      this.mode = 'idle';
      this.currentStep = null;
      this.envelopeLines = [];
      return;
    }

    if (this.mode === 'capturing') {
      this.envelopeLines.push(line);
      // Only flush on the explicit `--- step-end: ... ---` marker (handled
      // above). Brace-counting was racing with chunk boundaries and
      // misfiring on nested objects (e.g. CLV's tier_counts), producing
      // null envelopes that the UI rendered as ✗.
    }
  }

  private flushEnvelope() {
    if (!this.currentStep) return;
    const text = this.envelopeLines.join('\n').trim();
    let envelope: Record<string, unknown> | null = null;
    if (text) {
      const open = text.indexOf('{');
      const close = text.lastIndexOf('}');
      if (open >= 0 && close > open) {
        try { envelope = JSON.parse(text.slice(open, close + 1)); }
        catch { /* malformed — ignore */ }
      }
    }
    this.events.push({
      event: 'step-end',
      name: this.currentStep,
      envelope,
    });
    this.mode = 'idle';
    this.currentStep = null;
    this.envelopeLines = [];
  }

  drain(): typeof this.events {
    const out = this.events;
    this.events = [];
    return out;
  }
}

export async function POST(req: Request) {
  const guard = await requireLoggedInAdmin(req);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => ({})) as {
    today?: string; thresholdPct?: number; oppCeiling?: number;
    autoTiers?: string[]; scenario?: string;
  };

  const repoPath = process.env.M3_REPO_PATH || DEFAULT_M3_REPO;

  // Optional pre-load of a scenario
  if (body.scenario) {
    await new Promise<void>(resolve => {
      const c = spawn('python3', ['scripts/simulate/tick.py', '--load', body.scenario!], {
        cwd: repoPath, env: process.env,
      });
      c.on('close', () => resolve());
      c.on('error', () => resolve());
    });
  }

  const args: string[] = [];
  if (body.today)                             args.push('--today', body.today);
  if (typeof body.thresholdPct === 'number')  args.push('--threshold-pct', String(body.thresholdPct));
  if (typeof body.oppCeiling === 'number')    args.push('--opp-ceiling', String(body.oppCeiling));
  if (body.autoTiers?.length)                 args.push('--auto-tiers', body.autoTiers.join(','));

  const working = path.join(repoPath, 'data', 'working');
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      };
      // Emit immediately so the client knows the connection is live
      send({ event: 'opened', today: body.today ?? new Date().toISOString().slice(0, 10) });

      const child = spawn('uv', ['run', 'python', 'scripts/orchestrator.py', ...args], {
        cwd: repoPath,
        // PYTHONUNBUFFERED so Python flushes each print immediately
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });

      const parser = new StreamParser();
      let buf = '';
      let reviewAnywhere = false;

      child.stdout.on('data', async (chunk: Buffer) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          parser.feed(line);
          for (const ev of parser.drain()) {
            // For step-end events, attach the decisions CSV
            if (ev.event === 'step-end') {
              const name = ev.name as string;
              const env = ev.envelope as Record<string, unknown> | null;
              const fname = STEP_ARTIFACT[name];
              let decisions: Record<string, string>[] = [];
              let artifact = '';
              if (fname) {
                artifact = `working/${fname}`;
                try {
                  const text = await readFile(path.join(working, fname), 'utf8');
                  decisions = parseCsv(text);
                } catch { /* file not yet ready */ }
              }
              if (env && (env as any).review_required) reviewAnywhere = true;
              send({ event: 'step-end', name, envelope: env, decisions, artifact });
            } else {
              send(ev);
            }
          }
        }
      });

      child.stderr.on('data', () => { /* swallow — surface in error event if exit != 0 */ });

      child.on('error', e => {
        send({ event: 'run-error', message: e.message });
        controller.close();
      });

      child.on('close', code => {
        // Flush any trailing buffered line
        if (buf) {
          parser.feed(buf);
          for (const ev of parser.drain()) send(ev);
        }
        if (code !== 0) {
          send({ event: 'run-error', message: `orchestrator exited ${code}` });
        }
        send({ event: 'run-end', review_required: reviewAnywhere });
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no', // tell any proxy not to buffer
    },
  });
}
