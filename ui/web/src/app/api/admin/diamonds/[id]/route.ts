import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/audit';

const patchSchema = z.object({
  status: z.enum(['AVAILABLE', 'HOLD', 'SOLD', 'NOT_LIVE']).optional(),
  pricePerCarat: z.coerce.number().optional(),
  totalPrice: z.coerce.number().optional(),
  remarks: z.string().optional(),
  location: z.string().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req, 'inventory', 'edit');
  if (!guard.ok) return guard.response;
  const admin = guard.admin;

  const data = patchSchema.parse(await req.json());
  const before = await prisma.diamond.findUnique({
    where: { id: params.id },
    select: { id: true, stoneId: true, status: true, pricePerCarat: true, totalPrice: true, remarks: true, location: true },
  });
  if (!before) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const diamond = await prisma.diamond.update({ where: { id: params.id }, data: data as any });

  // Per-field audit so the log reads cleanly.
  if (data.status && data.status !== before.status) {
    await audit({
      actorId: admin.id,
      action: data.status === 'AVAILABLE' && before.status === 'NOT_LIVE'
        ? 'stone.set_live'
        : 'stone.status_change',
      targetType: 'Diamond', targetId: diamond.id,
      oldValue: { stoneId: before.stoneId, status: before.status },
      newValue: { status: data.status },
    });
  }
  if (data.pricePerCarat != null || data.totalPrice != null || data.remarks !== undefined || data.location !== undefined) {
    await audit({
      actorId: admin.id, action: 'stone.edit',
      targetType: 'Diamond', targetId: diamond.id,
      oldValue: {
        pricePerCarat: Number(before.pricePerCarat),
        totalPrice: Number(before.totalPrice),
        remarks: before.remarks, location: before.location,
      },
      newValue: {
        ...(data.pricePerCarat != null ? { pricePerCarat: data.pricePerCarat } : {}),
        ...(data.totalPrice    != null ? { totalPrice: data.totalPrice } : {}),
        ...(data.remarks     !== undefined ? { remarks: data.remarks } : {}),
        ...(data.location    !== undefined ? { location: data.location } : {}),
      },
    });
  }

  return NextResponse.json(diamond);
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req, 'inventory', 'edit');
  if (!guard.ok) return guard.response;

  const stone = await prisma.diamond.findUnique({
    where: { id: params.id },
    select: { stoneId: true, status: true, pricePerCarat: true },
  });
  await prisma.diamond.delete({ where: { id: params.id } });

  if (stone) {
    await audit({
      actorId: guard.admin.id, action: 'stone.delete',
      targetType: 'Diamond', targetId: params.id,
      oldValue: { stoneId: stone.stoneId, status: stone.status, pricePerCarat: Number(stone.pricePerCarat) },
    });
  }

  return NextResponse.json({ ok: true });
}
