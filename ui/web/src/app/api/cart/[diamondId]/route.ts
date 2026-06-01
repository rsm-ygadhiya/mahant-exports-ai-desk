import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCustomerSession } from '@/lib/session';

export async function DELETE(_req: Request, { params }: { params: { diamondId: string } }) {
  const session = await getCustomerSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  await prisma.cartItem.deleteMany({
    where: { customerId: session.sub, diamondId: params.diamondId },
  });
  return NextResponse.json({ ok: true });
}
