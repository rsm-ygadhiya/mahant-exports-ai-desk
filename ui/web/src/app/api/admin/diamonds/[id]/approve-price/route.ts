import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/audit';

/**
 * POST /api/admin/diamonds/:id/approve-price
 *
 * Spec §5.3 — final step of the new-stock review flow. Sets the final price
 * and flips the stone to LIVE (status = AVAILABLE) in one transaction.
 *
 * Body: { pricePerCarat: number, note?: string }
 *
 * Permission: inventory.set_live (Sales by default; Accounts can't).
 */
const schema = z.object({
  pricePerCarat: z.coerce.number().positive(),
  note: z.string().max(500).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req, 'inventory', 'set_live');
  if (!guard.ok) return guard.response;
  const admin = guard.admin;

  const body = schema.parse(await req.json());
  const stone = await prisma.diamond.findUnique({ where: { id: params.id } });
  if (!stone) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (stone.status !== 'NOT_LIVE') {
    return NextResponse.json({ error: 'Stone is not awaiting price approval.' }, { status: 400 });
  }

  const carat = Number(stone.carat);
  const newTotal = body.pricePerCarat * carat;

  const updated = await prisma.diamond.update({
    where: { id: params.id },
    data: {
      status: 'AVAILABLE',
      pricePerCarat: body.pricePerCarat as any,
      totalPrice: newTotal as any,
    },
  });

  await audit({
    actorId: admin.id,
    action: 'stone.set_live',
    targetType: 'Diamond',
    targetId: stone.id,
    oldValue: { status: stone.status, pricePerCarat: Number(stone.pricePerCarat) },
    newValue: { status: 'AVAILABLE', pricePerCarat: body.pricePerCarat },
    notes: body.note,
  });

  return NextResponse.json(updated);
}
