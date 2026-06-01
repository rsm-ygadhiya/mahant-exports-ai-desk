import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { RunReviewer } from './RunReviewer';

export const dynamic = 'force-dynamic';

export default async function RunDetail({ params }: { params: { id: string } }) {
  const run = await prisma.pricingRun.findUnique({
    where: { id: params.id },
    include: {
      proposals: {
        include: {
          diamond: {
            select: {
              stoneId: true, shape: true, carat: true, color: true, clarity: true,
              cut: true, polish: true, symmetry: true, fluorescence: true, lab: true,
            },
          },
        },
        orderBy: { changePct: 'asc' }, // biggest discounts first
      },
    },
  });
  if (!run) return notFound();

  // Serialize Decimal → number for the client component.
  const proposals = run.proposals.map(p => ({
    id: p.id,
    diamondId: p.diamondId,
    stoneId: p.diamond.stoneId,
    shape: p.diamond.shape,
    carat: Number(p.diamond.carat),
    color: p.diamond.color,
    clarity: p.diamond.clarity,
    cut: p.diamond.cut ?? null,
    polish: p.diamond.polish ?? null,
    symmetry: p.diamond.symmetry ?? null,
    fluorescence: p.diamond.fluorescence ?? null,
    lab: p.diamond.lab ?? null,
    oldPpc: Number(p.oldPpc),
    proposedPpc: Number(p.proposedPpc),
    rapPrice: p.rapPrice == null ? null : Number(p.rapPrice),
    changePct: Number(p.changePct),
    reasoning: p.reasoning,
    status: p.status,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Pricing Run</h1>
          <p className="text-sm text-brand-700 mt-1">
            {run.mode === 'ai' ? '✨ AI' : '⚡ Heuristic'} · created {new Date(run.createdAt).toLocaleString()}
            {run.appliedAt && <> · applied {new Date(run.appliedAt).toLocaleString()}</>}
            {run.notes && <> · <i>{run.notes}</i></>}
          </p>
        </div>
        <Link href="/admin/pricing" className="btn-outline">← All runs</Link>
      </div>

      {run.summary && (
        <div className="card p-5 bg-gradient-to-br from-brand-700 to-brand-900 text-white">
          <div className="text-xs uppercase tracking-widest text-gold-400 mb-1">Summary</div>
          <p className="text-sm text-brand-100">{run.summary}</p>
        </div>
      )}

      <RunReviewer runId={run.id} initialProposals={proposals} runStatus={run.status} />
    </div>
  );
}
