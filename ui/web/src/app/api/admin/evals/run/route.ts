/**
 * POST /api/admin/evals/run  { suite: 'triage' | 'repricing' | 'clv' | 'memo' }
 *
 * Spawns `uv run python tests/evals/run_evals.py --suite <suite>` inside the
 * milestone-03 repo and returns the JSON the runner prints to stdout.
 *
 * The runner is intentionally side-effect-free (read-only over data/working/
 * CSVs) so we can let any admin with `ai_briefing.view` trigger it.
 */

import { spawn } from 'node:child_process';
import { NextResponse } from 'next/server';
import { requireLoggedInAdmin } from '@/lib/adminGuard';
import { hasPermission } from '@/lib/permissions';

const DEFAULT_M3_REPO =
  '/Users/lucifer/Desktop/MSBA/Spring/Gen AI/mgt449-milestone03-Group-10';

const VALID_SUITES = new Set(['triage', 'repricing', 'clv', 'memo']);

export async function POST(req: Request) {
  const guard = await requireLoggedInAdmin(req);
  if (!guard.ok) return guard.response;

  if (!hasPermission(guard.admin as any, 'ai_briefing', 'view')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: { suite?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const suite = (body.suite ?? '').trim();
  if (!VALID_SUITES.has(suite)) {
    return NextResponse.json({ error: `unknown suite: ${suite}` }, { status: 400 });
  }

  const repoPath = process.env.M3_REPO_PATH || DEFAULT_M3_REPO;

  const result = await new Promise<{ ok: boolean; data?: any; error?: string }>(resolve => {
    const child = spawn(
      'uv',
      ['run', 'python', 'tests/evals/run_evals.py', '--suite', suite],
      { cwd: repoPath, env: { ...process.env, PYTHONUNBUFFERED: '1' } },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', e => resolve({ ok: false, error: `spawn failed: ${e.message}` }));
    child.on('close', code => {
      // The runner emits JSON even when individual cases fail; it only exits
      // non-zero if the runner itself crashes.
      try {
        const data = JSON.parse(stdout);
        resolve({ ok: code === 0 || !!data, data, error: code !== 0 ? stderr : undefined });
      } catch {
        resolve({
          ok: false,
          error: `runner exit ${code}; stdout was not JSON:\n${stdout.slice(0, 500)}\n---stderr---\n${stderr.slice(0, 500)}`,
        });
      }
    });
  });

  if (!result.ok && !result.data) {
    return NextResponse.json({ error: result.error ?? 'runner failed' }, { status: 500 });
  }
  return NextResponse.json(result.data);
}
