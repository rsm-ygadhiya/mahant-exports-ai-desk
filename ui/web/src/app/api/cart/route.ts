import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getCustomerSession } from '@/lib/session';

export async function POST(req: Request) {
  const session = await getCustomerSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { diamondId } = z.object({ diamondId: z.string() }).parse(await req.json());
  await prisma.cartItem.upsert({
    where: { customerId_diamondId: { customerId: session.sub, diamondId } },
    create: { customerId: session.sub, diamondId },
    update: {},
  });
  return NextResponse.json({ ok: true });
}
