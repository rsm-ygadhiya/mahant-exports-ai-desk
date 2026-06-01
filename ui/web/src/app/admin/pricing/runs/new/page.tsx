import Link from 'next/link';
import { prisma } from '@/lib/db';
import { StartRunForm } from './StartRunForm';

export const dynamic = 'force-dynamic';

export default async function NewRunPage() {
  const [available, latestRap, rapCount] = await Promise.all([
    prisma.diamond.count({ where: { status: 'AVAILABLE' } }),
    prisma.rapRate.findFirst({ orderBy: { sheetDate: 'desc' } }),
    prisma.rapRate.count(),
  ]);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Start a new pricing run</h1>
          <p className="text-sm text-brand-700 mt-1">
            Generates one proposal per available stone. Nothing is applied to live prices until you review and push.
          </p>
        </div>
        <Link href="/admin/pricing" className="btn-outline">← Back</Link>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <Stat label="Available stones" value={available.toLocaleString()} />
        <Stat label="Latest Rap sheet" value={latestRap ? new Date(latestRap.sheetDate).toLocaleDateString() : '—'} />
        <Stat label="Rap rate rows" value={rapCount.toLocaleString()} sub={rapCount === 0 ? 'Upload Rap rates for category-aware pricing' : undefined} />
      </div>

      {rapCount === 0 && (
        <div className="card p-4 bg-amber-50/50 border-amber-200 text-sm text-amber-800">
          <b>No Rap rates yet.</b> The engine will fall back to the current $/ct as the basis for each stone, applying only the age + demand adjustments.
          Recommended: <Link href="/admin/pricing/rap" className="underline">upload your latest Rap sheet first</Link>.
        </div>
      )}

      <StartRunForm available={available} />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-widest text-brand-700">{label}</div>
      <div className="text-2xl font-serif mt-1 text-brand-900">{value}</div>
      {sub && <div className="text-xs text-brand-700 mt-1">{sub}</div>}
    </div>
  );
}
