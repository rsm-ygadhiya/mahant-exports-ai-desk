import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/audit';

/**
 * POST /api/admin/pending-stock/bulk-approve
 *
 * Approve a batch of NOT_LIVE stones at once. Each entry pairs a stone id
 * with the price-per-carat to apply. Skips anything not currently NOT_LIVE.
 *
 * Body: { items: Array<{ id: string, pricePerCarat: number }> }
 *
 * Permission: inventory.set_live.
 */
const schema = z.object({
  items: z.array(z.object({
    id: z.string(),
    pricePerCarat: z.coerce.number().positive(),
  })).min(1).max(500),
});

export async function POST(req: Request) {
  const guard = await requireAdmin(req, 'inventory', 'set_live');
  if (!guard.ok) return guard.response;
  const admin = guard.admin;

  const { items } = schema.parse(await req.json());

  const stones = await prisma.diamond.findMany({
    where: { id: { in: items.map(i => i.id) }, status: 'NOT_LIVE' },
    select: { id: true, carat: true, stoneId: true },
  });
  const stoneMap = new Map(stones.map(s => [s.id, s]));

  let approved = 0;
  const skipped: string[] = [];
  for (const it of items) {
    const stone = stoneMap.get(it.id);
    if (!stone) { skipped.push(it.id); continue; }
    const carat = Number(stone.carat);
    const total = it.pricePerCarat * carat;
    await prisma.diamond.update({
      where: { id: it.id },
      data: {
        status: 'AVAILABLE',
        pricePerCarat: it.pricePerCarat as any,
        totalPrice: total as any,
      },
    });
    approved++;
  }

  await audit({
    actorId: admin.id,
    action: 'stone.set_live',
    targetType: 'Diamond',
    notes: `Bulk-approved ${approved} stones (${skipped.length} skipped)`,
    newValue: { approvedCount: approved },
  });

  return NextResponse.json({ approved, skipped: skipped.length });
}
