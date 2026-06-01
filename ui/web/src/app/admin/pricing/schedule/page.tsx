import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { getSchedule, computeNextRunAt } from '@/lib/pricingSchedule';
import { ScheduleForm } from './ScheduleForm';

export const dynamic = 'force-dynamic';

export default async function PricingSchedulePage() {
  const me = await getCurrentAdmin();
  if (!me) redirect('/admin/login');
  if (!hasPermission(me as any, 'pricing', 'view')) {
    return <div className="card p-6 text-sm text-brand-700">No access to Pricing.</div>;
  }

  const sched = await getSchedule();
  const canEdit = hasPermission(me as any, 'pricing', 'edit');
  const canRun  = hasPermission(me as any, 'pricing', 'run');

  // Sanity preview: what's the next-run-at given the current saved config?
  const previewNext = sched.enabled ? computeNextRunAt(sched as any, new Date()) : null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/admin/pricing" className="text-xs text-brand-700 hover:underline">← Back to Pricing</Link>
          <h1 className="font-serif text-3xl mt-2">Pricing automation</h1>
          <p className="text-sm text-brand-700 mt-1">
            Auto-generate a fresh pricing run on a schedule. Each tick creates a DRAFT
            run (PENDING proposals); review and apply via the regular pricing page —
            nothing touches live stock until you click <b>Push to inventory</b>.
          </p>
        </div>
      </div>

      <div className="card p-4 grid md:grid-cols-3 gap-3 text-sm">
        <StatusTile
          label="Status"
          value={sched.enabled ? '● Running' : '○ Disabled'}
          tone={sched.enabled ? 'green' : 'brand'}
        />
        <StatusTile
          label="Last run"
          value={sched.lastRunAt ? new Date(sched.lastRunAt).toLocaleString() : 'Never'}
          sub={sched.lastRunStatus ?? undefined}
        />
        <StatusTile
          label="Next run"
          value={previewNext ? previewNext.toLocaleString() : '—'}
          sub={sched.enabled ? 'fires once due' : 'enable to schedule'}
        />
      </div>

      {sched.lastError && (
        <div className="card p-3 bg-rose-50 border-rose-200 text-sm text-rose-800">
          <b>Last error:</b> {sched.lastError}
        </div>
      )}
      {sched.lastRunId && sched.lastRunStatus === 'ok' && (
        <div className="card p-3 bg-emerald-50/60 border-emerald-200 text-sm text-emerald-800 flex items-center justify-between">
          <span>Most recent scheduled run created a DRAFT pricing run.</span>
          <Link href={`/admin/pricing/runs/${sched.lastRunId}`} className="text-emerald-700 hover:underline">
            Open run →
          </Link>
        </div>
      )}

      <ScheduleForm
        initial={{
          enabled: sched.enabled,
          frequency: sched.frequency,
          timeOfDay: sched.timeOfDay,
          dayOfWeek: sched.dayOfWeek,
          mode: sched.mode as 'ai' | 'heuristic',
          rapDiscountPct: Number(sched.rapDiscountPct),
          skipIfRecentHrs: sched.skipIfRecentHrs,
        }}
        canEdit={canEdit}
        canRun={canRun}
      />

      <div className="card p-4 text-xs text-brand-700 space-y-2">
        <div className="text-brand-900 font-medium">How to actually run the cron</div>
        <p>
          The schedule itself is just configuration — something external needs to ping
          our <span className="font-mono">/api/cron/pricing-tick</span> endpoint regularly.
          Pick whichever fits your hosting:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <b>Vercel</b>: add a cron entry to <span className="font-mono">vercel.json</span>:
            <pre className="bg-brand-50 p-2 rounded mt-1">{`{ "crons": [{ "path": "/api/cron/pricing-tick", "schedule": "*/10 * * * *" }] }`}</pre>
          </li>
          <li>
            <b>Self-hosted / dev</b>: add a line to your crontab:
            <pre className="bg-brand-50 p-2 rounded mt-1">{`*/10 * * * * curl -s -H "x-cron-secret: $CRON_SECRET" https://your-domain.tld/api/cron/pricing-tick`}</pre>
          </li>
          <li>
            Set <span className="font-mono">CRON_SECRET</span> in your <span className="font-mono">.env</span> to a long random string.
          </li>
        </ul>
      </div>
    </div>
  );
}

function StatusTile({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: 'green' | 'brand' | 'amber' | 'rose';
}) {
  const cls = tone === 'green' ? 'text-emerald-700'
            : tone === 'amber' ? 'text-amber-700'
            : tone === 'rose'  ? 'text-rose-700'
            : 'text-brand-900';
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-brand-700">{label}</div>
      <div className={`text-lg font-serif mt-1 ${cls}`}>{value}</div>
      {sub && <div className="text-xs text-brand-700 mt-0.5">{sub}</div>}
    </div>
  );
}
