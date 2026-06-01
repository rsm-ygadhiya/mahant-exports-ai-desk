import Link from 'next/link';
import { prisma } from '@/lib/db';
import { fmtUsd } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function PricingIndex() {
  const [runs, latestRap, rapShapeCount, proposalCounts] = await Promise.all([
    prisma.pricingRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { _count: { select: { proposals: true } } },
    }),
    prisma.rapRate.findFirst({ orderBy: { sheetDate: 'desc' } }),
    prisma.rapRate.groupBy({ by: ['shape'], _count: { _all: true } }),
    prisma.pricingProposal.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const counts: Record<string, number> = {};
  for (const r of proposalCounts) counts[r.status] = r._count._all;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Pricing Workflow</h1>
          <p className="text-sm text-brand-700 mt-1">
            Upload Rap rates, generate price proposals per stone, review with reasoning, approve, and push to inventory — all gated by your admin passcode.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/pricing/schedule" className="btn-outline">⏰ Schedule</Link>
          <Link href="/admin/pricing/rap" className="btn-outline">⬆ Manage Rap rates</Link>
          <Link href="/admin/pricing/runs/new" className="btn-primary">＋ Start new run</Link>
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-3">
        <Stat label="Latest Rap sheet" value={latestRap ? new Date(latestRap.sheetDate).toLocaleDateString() : '—'}
              sub={latestRap ? `${rapShapeCount.length} shape${rapShapeCount.length === 1 ? '' : 's'}` : 'No rates uploaded yet'} />
        <Stat label="Pending proposals" value={(counts.PENDING ?? 0).toLocaleString()} tone="amber" />
        <Stat label="Approved (not yet applied)" value={(counts.APPROVED ?? 0).toLocaleString()} tone="green" />
        <Stat label="Applied all-time" value={(counts.APPLIED ?? 0).toLocaleString()} tone="brand" />
      </div>

      <div>
        <h2 className="font-serif text-xl mb-3">Run history</h2>
        {runs.length === 0 ? (
          <div className="card p-6 text-center text-sm text-brand-700">
            No runs yet. <Link className="text-gold-600 underline" href="/admin/pricing/runs/new">Start the first one →</Link>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-brand-50 text-brand-700 text-left">
                <tr>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Mode</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Proposals</th>
                  <th className="px-3 py-2">Rap sheet</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.id} className="border-t border-brand-100">
                    <td className="px-3 py-2">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      {r.mode === 'ai' ? '✨ AI' : '⚡ Heuristic'}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="px-3 py-2 text-right">{r._count.proposals}</td>
                    <td className="px-3 py-2 text-xs">{r.rapDate ? new Date(r.rapDate).toLocaleDateString() : '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <Link href={`/admin/pricing/runs/${r.id}`} className="text-gold-600 hover:underline">Open →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'green' | 'amber' | 'rose' | 'brand' }) {
  const cls = tone === 'green' ? 'text-emerald-700'
            : tone === 'amber' ? 'text-amber-700'
            : tone === 'rose' ? 'text-rose-700'
            : tone === 'brand' ? 'text-brand-700' : 'text-brand-900';
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-widest text-brand-700">{label}</div>
      <div className={`text-2xl font-serif mt-1 ${cls}`}>{value}</div>
      {sub && <div className="text-xs text-brand-700 mt-1">{sub}</div>}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    DRAFT: 'bg-amber-50 text-amber-700',
    APPLIED: 'bg-emerald-50 text-emerald-700',
    DISCARDED: 'bg-brand-50 text-brand-700',
  };
  return <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? 'bg-brand-50'}`}>{status}</span>;
}
