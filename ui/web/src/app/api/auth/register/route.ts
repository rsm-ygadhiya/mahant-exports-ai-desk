import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';

export async function POST(req: Request) {
  const body = z.object({
    mobile: z.string().min(8),
    email: z.string().email().optional(),
    password: z.string().min(6).optional(),
    companyName: z.string().min(1),
    contactPerson: z.string().min(1),
    country: z.string().optional(),
    city: z.string().optional(),
  }).parse(await req.json());

  const passwordHash = body.password ? await bcrypt.hash(body.password, 10) : undefined;

  const customer = await prisma.customer.upsert({
    where: { mobile: body.mobile },
    update: {
      email: body.email,
      passwordHash,
      companyName: body.companyName,
      contactPerson: body.contactPerson,
      country: body.country,
      city: body.city,
    },
    create: {
      mobile: body.mobile,
      email: body.email,
      passwordHash,
      companyName: body.companyName,
      contactPerson: body.contactPerson,
      country: body.country,
      city: body.city,
    },
  });
  return NextResponse.json({ customer });
}
