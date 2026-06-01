import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/adminGuard';
import { hasPermission } from '@/lib/permissions';
import { audit } from '@/lib/audit';

const patchSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']).optional(),
  pricingRule: z.object({
    mode: z.enum(['BASE', 'ADJUST_PCT', 'HIDDEN']),
    adjustPct: z.coerce.number().nullable().optional(),
    notes: z.string().optional(),
  }).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  // Any change to a customer requires customers.edit. Approving a customer
  // additionally needs customers.approve (since approval is what unlocks prices).
  const guard = await requireAdmin(req, 'customers', 'edit');
  if (!guard.ok) return guard.response;
  const admin = guard.admin;

  const body = patchSchema.parse(await req.json());

  if (body.status === 'APPROVED' && !hasPermission(admin, 'customers', 'approve')) {
    return NextResponse.json(
      { error: 'forbidden — missing permission customers.approve' },
      { status: 403 },
    );
  }

  const before = await prisma.customer.findUnique({
    where: { id: params.id },
    include: { pricingRule: true },
  });
  if (!before) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (body.status) {
    await prisma.customer.update({ where: { id: params.id }, data: { status: body.status } });
  }
  if (body.pricingRule) {
    const { mode, adjustPct, notes } = body.pricingRule;
    await prisma.pricingRule.upsert({
      where: { customerId: params.id },
      create: { customerId: params.id, mode, adjustPct: adjustPct as any, notes },
      update: { mode, adjustPct: adjustPct as any, notes },
    });
  }

  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
    include: { pricingRule: true },
  });

  // Audit: capture only the fields that actually changed.
  if (body.status && body.status !== before.status) {
    await audit({
      actorId: admin.id, action: 'customer.edit',
      targetType: 'Customer', targetId: customer!.id,
      oldValue: { status: before.status }, newValue: { status: body.status },
    });
  }
  if (body.pricingRule) {
    await audit({
      actorId: admin.id, action: 'customer.edit',
      targetType: 'Customer', targetId: customer!.id,
      oldValue: { pricingRule: before.pricingRule },
      newValue: { pricingRule: body.pricingRule },
    });
  }

  return NextResponse.json(customer);
}
