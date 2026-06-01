import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCurrentAdmin } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { NewOrderForm } from './NewOrderForm';

export const dynamic = 'force-dynamic';

export default async function NewOrderPage({
  searchParams,
}: { searchParams: { customer?: string } }) {
  const me = await getCurrentAdmin();
  if (!me) redirect('/admin/login');
  if (!hasPermission(me as any, 'sales', 'edit')) {
    return <div className="card p-6 text-sm text-brand-700">No permission to create orders.</div>;
  }

  const customers = await prisma.customer.findMany({
    where: { status: 'APPROVED' },
    select: { id: true, uniqueCode: true, companyName: true, contactPerson: true, mobile: true },
    orderBy: { companyName: 'asc' },
    take: 500,
  });

  // Stones the admin can pick from — AVAILABLE + HOLD (you can sell either).
  const stones = await prisma.diamond.findMany({
    where: { status: { in: ['AVAILABLE', 'HOLD'] } },
    select: {
      id: true, stoneId: true, shape: true, carat: true, color: true, clarity: true,
      lab: true, certificateNo: true, status: true,
      pricePerCarat: true, totalPrice: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 1000,
  });

  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin/sales" className="text-xs text-brand-700 hover:underline">← Back to Sales</Link>
        <h1 className="font-serif text-3xl mt-2">New order</h1>
        <p className="text-sm text-brand-700">Pick a customer, add stones from current stock, set the agreed prices, then confirm to flip stones to Sold.</p>
      </div>

      <NewOrderForm
        customers={customers.map(c => ({
          id: c.id, uniqueCode: c.uniqueCode,
          companyName: c.companyName, contactPerson: c.contactPerson, mobile: c.mobile,
        }))}
        defaultCustomerId={searchParams.customer ?? null}
        stones={stones.map(s => ({
          id: s.id, stoneId: s.stoneId, shape: s.shape,
          carat: Number(s.carat), color: s.color, clarity: s.clarity,
          lab: s.lab, certificateNo: s.certificateNo,
          status: s.status as 'AVAILABLE' | 'HOLD',
          pricePerCarat: Number(s.pricePerCarat), totalPrice: Number(s.totalPrice),
        }))}
      />
    </div>
  );
}
