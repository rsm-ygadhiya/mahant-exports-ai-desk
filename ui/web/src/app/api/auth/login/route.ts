import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { setCustomerSession } from '@/lib/session';

export async function POST(req: Request) {
  const { email, password } = z.object({
    email: z.string().email(),
    password: z.string(),
  }).parse(await req.json());

  const customer = await prisma.customer.findUnique({ where: { email } });
  if (!customer || !customer.passwordHash) {
    return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
  }
  const ok = await bcrypt.compare(password, customer.passwordHash);
  if (!ok) return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });

  await setCustomerSession(customer.id);
  return NextResponse.json({ customer });
}
