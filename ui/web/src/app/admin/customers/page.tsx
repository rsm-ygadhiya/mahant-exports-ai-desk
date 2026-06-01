import Link from 'next/link';
import { prisma } from '@/lib/db';
import { CustomerRow } from './CustomerRow';

export const dynamic = 'force-dynamic';

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const;
const KYC_STATUSES = ['NOT_SUBMITTED', 'SUBMITTED', 'MORE_DOCS_NEEDED', 'APPROVED', 'REJECTED'] as const;

export default async function AdminCustomersPage({
  searchParams,
}: { searchParams: { status?: string; kyc?: string } }) {
  const statusFilter = (STATUSES as readonly string[]).includes(searchParams.status ?? '')
    ? (searchParams.status as typeof STATUSES[number])
    : undefined;
  const kycFilter = (KYC_STATUSES as readonly string[]).includes(searchParams.kyc ?? '')
    ? (searchParams.kyc as typeof KYC_STATUSES[number])
    : undefined;

  const customers = await prisma.customer.findMany({
    where: {
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(kycFilter ? { kycStatus: kycFilter } : {}),
    },
    include: {
      pricingRule: true,
      _count: { select: { enquiries: true, documents: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const linkFor = (next: { status?: string; kyc?: string }) => {
    const params = new URLSearchParams();
    if (next.status !== undefined ? next.status : statusFilter) {
      params.set('status', String(next.status !== undefined ? next.status : statusFilter));
    }
    if (next.kyc !== undefined ? next.kyc : kycFilter) {
      params.set('kyc', String(next.kyc !== undefined ? next.kyc : kycFilter));
    }
    const qs = params.toString();
    return qs ? `/admin/customers?${qs}` : '/admin/customers';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-3xl">Customers</h1>
        <Link href="/admin/customers/new" className="btn-primary">＋ New customer</Link>
      </div>

      <div className="card p-3 space-y-2 text-sm">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs uppercase tracking-widest text-brand-700 mr-1">Account:</span>
          <Link href={linkFor({ status: '' })} className={!statusFilter ? 'btn-primary' : 'btn-outline'}>All</Link>
          {STATUSES.map(s => (
            <Link key={s} href={linkFor({ status: s })}
                  className={statusFilter === s ? 'btn-primary' : 'btn-outline'}>{s}</Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs uppercase tracking-widest text-brand-700 mr-1">KYC:</span>
          <Link href={linkFor({ kyc: '' })} className={!kycFilter ? 'btn-primary' : 'btn-outline'}>All</Link>
          {KYC_STATUSES.map(s => (
            <Link key={s} href={linkFor({ kyc: s })}
                  className={kycFilter === s ? 'btn-primary' : 'btn-outline'}>{s.replace('_', ' ')}</Link>
          ))}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-brand-50 text-brand-700 text-left">
            <tr>
              <th className="px-3 py-2">Customer ID</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Contact</th>
              <th className="px-3 py-2">Mobile / Email</th>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">KYC</th>
              <th className="px-3 py-2">Pricing</th>
              <th className="px-3 py-2 text-right">Docs</th>
              <th className="px-3 py-2 text-right">Enquiries</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {customers.map(c => <CustomerRow key={c.id} customer={c as any} />)}
            {customers.length === 0 && (
              <tr><td colSpan={10} className="text-center py-12 text-brand-700">No customers match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
