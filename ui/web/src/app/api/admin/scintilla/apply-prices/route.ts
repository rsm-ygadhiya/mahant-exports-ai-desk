/**
 * POST /api/admin/scintilla/apply-prices
 *
 * Push a batch of Scintilla repricing proposals into the live Mahant
 * inventory (so the customer-facing storefront sees the new prices).
 * Gated by a password the desk owner sets in `.env`
 * (`SCINTILLA_APPROVE_PASSWORD`) — defaults to `pramukh-2026` for the
 * demo if unset.
 *
 * Body:
 *   {
 *     password: string,
 *     stones: Array<{ stoneId: string, proposedTotalPrice: number }>
 *   }
 *
 * Response:
 *   { updated: number, failed: string[], errors: Record<string,string> }
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireLoggedInAdmin } from '@/lib/adminGuard';

const DEFAULT_PASSWORD = 'pramukh-2026';

type ApplyRequest = {
  password: string;
  stones: { stoneId: string; proposedTotalPrice: number }[];
};

export async function POST(req: Request) {
  const guard = await requireLoggedInAdmin(req);
  if (!guard.ok) return guard.response;

  const expected = process.env.SCINTILLA_APPROVE_PASSWORD || DEFAULT_PASSWORD;

  const body = await req.json().catch(() => null) as ApplyRequest | null;
  if (!body || typeof body.password !== 'string' || !Array.isArray(body.stones)) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  if (body.password !== expected) {
    return NextResponse.json(
      { error: 'wrong password — ask the desk owner for the Scintilla price-approval password.' },
      { status: 403 },
    );
  }

  if (body.stones.length === 0) {
    return NextResponse.json({ updated: 0, failed: [], errors: {} });
  }

  let updated = 0;
  const failed: string[] = [];
  const errors: Record<string, string> = {};

  for (const s of body.stones) {
    if (!s.stoneId || !isFinite(s.proposedTotalPrice) || s.proposedTotalPrice <= 0) {
      failed.push(s.stoneId || '<unknown>');
      errors[s.stoneId || '<unknown>'] = 'missing stoneId or non-positive price';
      continue;
    }
    try {
      // Look up to get carat (so we can compute pricePerCarat from total)
      const diamond = await prisma.diamond.findUnique({ where: { stoneId: s.stoneId } });
      if (!diamond) {
        failed.push(s.stoneId);
        errors[s.stoneId] = 'stone not in Mahant inventory (Diamond table)';
        continue;
      }
      const carat = Number(diamond.carat);
      if (!isFinite(carat) || carat <= 0) {
        failed.push(s.stoneId);
        errors[s.stoneId] = `bad carat value (${diamond.carat})`;
        continue;
      }
      const ppc = +(s.proposedTotalPrice / carat).toFixed(2);
      await prisma.diamond.update({
        where: { stoneId: s.stoneId },
        data: {
          pricePerCarat: ppc,
          totalPrice: s.proposedTotalPrice,
        },
      });
      updated += 1;
    } catch (e: any) {
      failed.push(s.stoneId);
      errors[s.stoneId] = e?.message ?? 'unknown Prisma error';
    }
  }

  return NextResponse.json({ updated, failed, errors });
}
