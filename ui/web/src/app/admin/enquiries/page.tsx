import Link from 'next/link';
import { prisma } from '@/lib/db';
import { fmtCarat, fmtUsd } from '@/lib/format';

export const dynamic = 'force-dynamic';

const STATUSES = ['ALL', 'NEW', 'CONTACTED', 'APPROVED_MEMO', 'APPROVED_SALE', 'CANCELLED'] as const;

export default async function AdminEnquiriesPage({
  searchParams,
}: { searchParams: { status?: string } }) {
  const filter = (STATUSES as readonly string[]).includes(searchParams.status ?? '')
    ? searchParams.status as typeof STATUSES[number]
    : 'ALL';

  const where = filter === 'ALL' ? undefined : { status: filter as any };

  const enquiries = await prisma.enquiry.findMany({
    where,
    include: {
      customer: true,
      items: { include: { diamond: true } },
      order: { select: { orderCode: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  // Pull confirmed-order totals per customer so we can show inline CLV.
  const customerIds = Array.from(new Set(enquiries.map(eq => eq.customerId)));
  const orderAggs = customerIds.length
    ? await prisma.order.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds }, status: 'CONFIRMED' },
        _sum: { totalAmount: true },
      })
    : [];
  const clvByCustomer = new Map(orderAggs.map(o => [o.customerId, Number(o._sum.totalAmount ?? 0)]));

  return (
    <div className="space-y-4">
      <h1 className="font-serif text-3xl">Enquiries</h1>

      <div className="flex flex-wrap gap-2 text-sm">
        {STATUSES.map(s => (
          <Link key={s} href={s === 'ALL' ? '/admin/enquiries' : `/admin/enquiries?status=${s}`}
                className={filter === s ? 'btn-primary' : 'btn-outline'}>
            {s.replace('_', ' ')}
          </Link>
        ))}
      </div>

      {enquiries.length === 0 ? (
        <div className="card p-8 text-center text-brand-700">No enquiries match.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-brand-50 text-brand-700 text-left">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2 text-right">CLV</th>
                <th className="px-3 py-2 text-right">Stones</th>
                <th className="px-3 py-2 text-right">Value</th>
                <th className="px-3 py-2">KYC</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {enquiries.map(eq => {
                const total = eq.items.reduce((s, it) => s + Number(it.totalPrice ?? 0), 0);
                const clv = clvByCustomer.get(eq.customerId) ?? 0;
                return (
                  <tr key={eq.id} className="border-t border-brand-100 align-top hover:bg-brand-50/40">
                    <td className="px-3 py-2 text-xs">{new Date(eq.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{eq.customer.companyName}</div>
                      <div className="text-xs text-brand-700">
                        {eq.customer.contactPerson}
                        {eq.customer.uniqueCode && <span className="font-mono text-gold-700"> · {eq.customer.uniqueCode}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-emerald-700 font-medium">{fmtUsd(clv)}</td>
                    <td className="px-3 py-2 text-right">{eq.items.length}</td>
                    <td className="px-3 py-2 text-right font-medium">{fmtUsd(total)}</td>
                    <td className="px-3 py-2"><KycPill status={eq.customer.kycStatus} /></td>
                    <td className="px-3 py-2"><StatusPill status={eq.status} /></td>
                    <td className="px-3 py-2 text-right">
                      <Link href={`/admin/enquiries/${eq.id}`} className="text-xs text-gold-600 hover:underline">Open →</Link>
                      {eq.order && (
                        <div className="text-xs text-brand-700 mt-0.5">
                          <Link href={`/admin/sales/${eq.order.orderCode}`} className="hover:underline font-mono">
                            {eq.order.orderCode}
                          </Link>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function KycPill({ status }: { status: string }) {
  const cls: Record<string, string> = {
    NOT_SUBMITTED: 'badge-gray',
    SUBMITTED: 'badge-amber',
    MORE_DOCS_NEEDED: 'badge-amber',
    APPROVED: 'badge-green',
    REJECTED: 'badge-red',
  };
  return <span className={cls[status] ?? 'badge-gray'}>{status.replace('_', ' ').toLowerCase()}</span>;
}

function StatusPill({ status }: { status: string }) {
  const cls: Record<string, string> = {
    NEW: 'badge-amber', CONTACTED: 'badge-amber',
    APPROVED_MEMO: 'badge-green', APPROVED_SALE: 'badge-green',
    CANCELLED: 'badge-red', CLOSED: 'badge-gray',
  };
  return <span className={cls[status] ?? 'badge-gray'}>{status.replace('_', ' ')}</span>;
}
