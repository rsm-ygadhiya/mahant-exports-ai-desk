import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/adminGuard';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req, 'enquiries', 'edit');
  if (!guard.ok) return guard.response;

  const { status } = z.object({
    status: z.enum(['NEW', 'CONTACTED', 'CLOSED']),
  }).parse(await req.json());

  const updated = await prisma.enquiry.update({ where: { id: params.id }, data: { status } });
  return NextResponse.json(updated);
}
