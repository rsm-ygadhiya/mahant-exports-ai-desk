/**
 * POST /api/admin/m3-workflow/reset
 *
 * Restores the M03 data/raw/ CSVs from data/raw/_baseline/ so the desk
 * can re-run Daybreak against a clean state during a live demo.
 *
 * Body: (none required) — optional `{ scenario: "name" }` loads a named
 * scenario snapshot instead of the bare baseline.
 *
 * Calls `python3 scripts/simulate/tick.py --reset` (or --load NAME) and
 * returns the simulator's confirmation message.
 */

import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { requireLoggedInAdmin } from '@/lib/adminGuard';

const DEFAULT_M3_REPO =
  '/Users/lucifer/Desktop/MSBA/Spring/Gen AI/mgt449-milestone03-Group-10';

function runTick(repo: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['scripts/simulate/tick.py', ...args], {
      cwd: repo, env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}

export async function POST(req: Request) {
  const guard = await requireLoggedInAdmin(req);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => ({})) as { scenario?: string };
  const repo = process.env.M3_REPO_PATH || DEFAULT_M3_REPO;

  const args = body.scenario ? ['--load', body.scenario] : ['--reset'];
  const { stdout, stderr, code } = await runTick(repo, args);

  if (code !== 0) {
    return NextResponse.json(
      { error: `tick.py exited ${code}`, stderr: stderr.slice(-2000) },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    action: body.scenario ? `loaded scenario ${body.scenario}` : 'reset to baseline',
    message: stdout.trim(),
  });
}
