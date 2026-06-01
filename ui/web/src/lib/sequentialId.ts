// Sequential ID generator using the `Counter` table.
//
// Race-safe because Prisma's `increment` issues an atomic UPDATE statement,
// so two simultaneous calls can't end up with the same value.
//
// Customer codes: CUST-YYYY-NNNNN (year + 5-digit sequence, e.g. CUST-2026-00001).

import { prisma } from './db';

/** Atomically increment a counter key and return the new value. */
export async function nextSequence(key: string): Promise<number> {
  // Upsert + atomic increment in one shot.
  const row = await prisma.counter.upsert({
    where: { key },
    update: { value: { increment: 1 } },
    create: { key, value: 1 },
    select: { value: true },
  });
  return row.value;
}

/** Issue a unique customer code for the current year. Format: CUST-YYYY-NNNNN. */
export async function nextCustomerCode(now: Date = new Date()): Promise<string> {
  const year = now.getFullYear();
  const seq = await nextSequence(`customer_${year}`);
  return `CUST-${year}-${String(seq).padStart(5, '0')}`;
}

/** Issue a unique order code for the current year. Format: ORD-YYYY-NNNNN. */
export async function nextOrderCode(now: Date = new Date()): Promise<string> {
  const year = now.getFullYear();
  const seq = await nextSequence(`order_${year}`);
  return `ORD-${year}-${String(seq).padStart(5, '0')}`;
}
