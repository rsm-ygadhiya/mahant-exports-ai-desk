import { NextResponse } from 'next/server';
import { requireLoggedInAdmin } from '@/lib/adminGuard';
import { getAll } from '@/lib/opportunities/store';

export async function GET(req: Request) {
  const guard = await requireLoggedInAdmin(req);
  if (!guard.ok) return guard.response;
  const opps = await getAll();
  opps.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  return NextResponse.json({ opportunities: opps });
}
