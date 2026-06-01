import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/audit';

const schema = z.object({
  mobile: z.string().min(8),
  email: z.string().email().optional().or(z.literal('')).transform(v => v || undefined),
  password: z.string().min(6).optional().or(z.literal('')).transform(v => v || undefined),
  companyName: z.string().min(1),
  contactPerson: z.string().min(1),
  country: z.string().optional(),
  city: z.string().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']).default('APPROVED'),
  pricingMode: z.enum(['BASE', 'ADJUST_PCT', 'HIDDEN']).default('BASE'),
  adjustPct: z.coerce.number().nullable().optional(),
  notes: z.string().optional().or(z.literal('')).transform(v => v || undefined),
});

export async function POST(req: Request) {
  // Admin-creating a customer is a customer-edit action. Approval status is
  // a property of that record so we don't enforce 'approve' separately here.
  const guard = await requireAdmin(req, 'customers', 'edit');
  if (!guard.ok) return guard.response;

  const body = schema.parse(await req.json());
  const passwordHash = body.password ? await bcrypt.hash(body.password, 10) : undefined;

  // Reject collision on mobile or email so admin sees a clear error.
  const dupe = await prisma.customer.findFirst({
    where: { OR: [{ mobile: body.mobile }, ...(body.email ? [{ email: body.email }] : [])] },
  });
  if (dupe) {
    return NextResponse.json({ error: 'A customer with that mobile or email already exists.' }, { status: 409 });
  }

  const customer = await prisma.customer.create({
    data: {
      mobile: body.mobile,
      email: body.email,
      passwordHash,
      companyName: body.companyName,
      contactPerson: body.contactPerson,
      country: body.country,
      city: body.city,
      status: body.status,
      pricingRule: {
        create: {
          mode: body.pricingMode,
          adjustPct: body.pricingMode === 'ADJUST_PCT' ? (body.adjustPct as any) : null,
          notes: body.notes,
        },
      },
    },
    include: { pricingRule: true },
  });

  await audit({
    actorId: guard.admin.id, action: 'customer.create',
    targetType: 'Customer', targetId: customer.id,
    newValue: {
      companyName: customer.companyName,
      mobile: customer.mobile,
      email: customer.email,
      status: customer.status,
      pricing: customer.pricingRule?.mode,
    },
  });

  return NextResponse.json(customer);
}
