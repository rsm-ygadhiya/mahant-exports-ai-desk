import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCurrentAdmin } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { suggestPricesForMany } from '@/lib/priceSuggestion';
import { PendingStockReview } from './PendingStockReview';

export const dynamic = 'force-dynamic';

export default async function PendingStockPage() {
  const me = await getCurrentAdmin();
  if (!me) redirect('/admin/login');
  if (!hasPermission(me as any, 'inventory', 'view')) {
    return (
      <div className="card p-8 max-w-xl">
        <h1 className="font-serif text-2xl">Restricted</h1>
        <p className="text-sm text-brand-700 mt-2">You don't have permission to view pending stock.</p>
      </div>
    );
  }

  const canApprove = hasPermission(me as any, 'inventory', 'set_live');

  const stones = await prisma.diamond.findMany({
    where: { status: 'NOT_LIVE' },
    orderBy: { createdAt: 'asc' },
    take: 500,
  });

  // Build similar-stone price suggestions for every pending stone.
  const fingerprints = stones.map(s => ({
    id: s.id,
    stoneId: s.stoneId,
    shape: s.shape,
    carat: Number(s.carat),
    color: s.color,
    clarity: s.clarity,
    cut: s.cut ?? null,
  }));
  const suggestions = await suggestPricesForMany(fingerprints);
  const byId = new Map(suggestions.map(s => [s.diamondId, s]));

  const rows = stones.map(s => {
    const sug = byId.get(s.id)!;
    const currentPpc = Number(s.pricePerCarat);
    return {
      id: s.id,
      stoneId: s.stoneId,
      shape: s.shape,
      carat: Number(s.carat),
      color: s.color,
      clarity: s.clarity,
      cut: s.cut ?? null,
      lab: s.lab ?? null,
      certificateNo: s.certificateNo ?? null,
      currentPpc: currentPpc > 0 ? currentPpc : null,
      addedAt: s.createdAt.toISOString(),
      suggestion: sug,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">Pending Stock — Price Approval</h1>
        <p className="text-sm text-brand-700 mt-1">
          New stock uploads land here. Each stone gets an AI-suggested price
          based on similar comparables in your inventory and sold history.
          Review, override if needed, and approve — only approved stones go live for buyers.
        </p>
      </div>

      {!canApprove && (
        <div className="card p-3 bg-amber-50/60 border-amber-200 text-sm text-amber-800">
          <b>View-only:</b> you don't have <span className="font-mono">inventory.set_live</span> permission.
          You can review the suggestions but only authorised users can actually approve them.
        </div>
      )}

      <PendingStockReview rows={rows} canApprove={canApprove} />
    </div>
  );
}
