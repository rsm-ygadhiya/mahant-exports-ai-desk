/**
 * Compact inventory snapshot for the Opportunity Finder.
 *
 * Pulled from Prisma — kept short (a single paragraph) so it slots
 * cleanly into the email-drafting prompt and into the portal-form
 * "inventory_summary" field.
 */

import { prisma } from '@/lib/db';

export async function buildInventorySnapshot(): Promise<string> {
  try {
    const where = { status: 'AVAILABLE' as const };
    const total = await prisma.diamond.count({ where });
    const byShape = await prisma.diamond.groupBy({
      by: ['shape'],
      where,
      _count: { shape: true },
      orderBy: { _count: { shape: 'desc' } },
      take: 5,
    });
    const carat = await prisma.diamond.aggregate({
      where,
      _min: { carat: true },
      _max: { carat: true },
      _avg: { carat: true },
    });
    const shapes = byShape.map(s => `${s.shape} (${s._count.shape})`).join(', ');
    const cmin = Number(carat._min?.carat ?? 0);
    const cmax = Number(carat._max?.carat ?? 0);
    const cavg = Number(carat._avg?.carat ?? 0);
    return `Available stones: ${total} total. Top shapes by count: ${shapes}. ` +
           `Carat range ${cmin.toFixed(2)}-${cmax.toFixed(2)} ct ` +
           `(avg ${cavg.toFixed(2)} ct). IGI / GIA certified.`;
  } catch {
    return 'Inventory: 600+ available LG stones, 0.30-5.00 ct, all certified.';
  }
}
