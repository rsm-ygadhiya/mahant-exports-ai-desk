import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getCurrentCustomer } from '@/lib/session';
import { applyPricing } from '@/lib/pricing';
import { buildEnquiryWhatsappUrl } from '@/lib/whatsapp';

export async function POST(req: Request) {
  const customer = await getCurrentCustomer();
  if (!customer) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { diamondIds, message } = z.object({
    diamondIds: z.array(z.string()).min(1),
    message: z.string().optional(),
  }).parse(await req.json());

  const diamonds = await prisma.diamond.findMany({ where: { id: { in: diamondIds } } });

  const itemsData = diamonds.map(d => {
    const priced = applyPricing(d, customer, customer.pricingRule ?? null);
    return {
      diamondId: d.id,
      pricePerCarat: (priced.priceHidden ? d.pricePerCarat : priced.pricePerCarat) as any,
      totalPrice: (priced.priceHidden ? d.totalPrice : priced.totalPrice) as any,
    };
  });

  const enquiry = await prisma.enquiry.create({
    data: {
      customerId: customer.id,
      message,
      items: { create: itemsData },
    },
  });

  // Clear cart on successful enquiry submission.
  await prisma.cartItem.deleteMany({
    where: { customerId: customer.id, diamondId: { in: diamondIds } },
  });

  return NextResponse.json({ id: enquiry.id, whatsappUrl: buildEnquiryWhatsappUrl(diamonds) });
}
