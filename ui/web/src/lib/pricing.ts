import type { Diamond, PricingRule, Customer } from '@prisma/client';

export type PricedDiamond = Diamond & { priceHidden: boolean };

/**
 * Apply per-customer pricing rule on top of base diamond price.
 * Pending/un-approved customers always see hidden prices regardless of rule.
 * (Spec section 9.)
 *
 * Rules:
 *   BASE       — show base price as-is
 *   ADJUST_PCT — show base * (1 + adjustPct/100)  (negative = discount)
 *   HIDDEN     — hide price; user must enquire
 */
export function applyPricing(
  diamond: Diamond,
  customer: Pick<Customer, 'status'> | null,
  rule: PricingRule | null,
): PricedDiamond {
  const isApproved = customer?.status === 'APPROVED';

  if (!isApproved || rule?.mode === 'HIDDEN') {
    return {
      ...diamond,
      pricePerCarat: null as unknown as Diamond['pricePerCarat'],
      totalPrice: null as unknown as Diamond['totalPrice'],
      priceHidden: true,
    };
  }

  if (rule?.mode === 'ADJUST_PCT' && rule.adjustPct != null) {
    const factor = 1 + Number(rule.adjustPct) / 100;
    const ppc = Number(diamond.pricePerCarat) * factor;
    const total = ppc * Number(diamond.carat);
    return {
      ...diamond,
      pricePerCarat: ppc.toFixed(2) as unknown as Diamond['pricePerCarat'],
      totalPrice: total.toFixed(2) as unknown as Diamond['totalPrice'],
      priceHidden: false,
    };
  }

  return { ...diamond, priceHidden: false };
}
