import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCurrentCustomer } from '@/lib/session';
import { fmtCarat, fmtUsd } from '@/lib/format';
import { LogoutButton } from './LogoutButton';

const KYC_BADGE: Record<string, { cls: string; label: string }> = {
  NOT_SUBMITTED:    { cls: 'badge-gray',  label: 'KYC: Not submitted' },
  SUBMITTED:        { cls: 'badge-amber', label: 'KYC: Under review' },
  MORE_DOCS_NEEDED: { cls: 'badge-amber', label: 'KYC: More docs needed' },
  APPROVED:         { cls: 'badge-green', label: 'KYC: Approved' },
  REJECTED:         { cls: 'badge-red',   label: 'KYC: Rejected' },
};

export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'badge-amber',
  APPROVED: 'badge-green',
  REJECTED: 'badge-red',
  SUSPENDED: 'badge-red',
};

export default async function AccountPage() {
  const customer = await getCurrentCustomer();
  if (!customer) redirect('/login');

  const enquiries = await prisma.enquiry.findMany({
    where: { customerId: customer.id },
    include: { items: { include: { diamond: true } } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">{customer.companyName}</h1>
          <p className="text-sm text-brand-700">{customer.contactPerson} · {customer.mobile}</p>
        </div>
        <LogoutButton />
      </div>

      <div className="card p-6 space-y-3">
        <div className="text-xs uppercase tracking-widest text-brand-700">Account status</div>
        <div className="flex flex-wrap items-center gap-3">
          <span className={STATUS_BADGE[customer.status]}>{customer.status}</span>
          <span className={KYC_BADGE[customer.kycStatus].cls}>{KYC_BADGE[customer.kycStatus].label}</span>
          {customer.uniqueCode && (
            <span className="text-xs px-2 py-0.5 rounded bg-gold-500/10 text-gold-700 font-mono">{customer.uniqueCode}</span>
          )}
        </div>

        {customer.status === 'PENDING' && (
          <p className="text-sm text-brand-700">
            Prices remain hidden until our team approves your account (usually within 1 business day).
          </p>
        )}
        {customer.status === 'APPROVED' && customer.pricingRule?.mode === 'HIDDEN' && (
          <p className="text-sm text-brand-700">
            Approved — but prices on your tier require manual quoting. Send an enquiry for any stone.
          </p>
        )}

        {customer.kycStatus !== 'APPROVED' && (
          <div className="border-t border-brand-100 pt-3 mt-1">
            <p className="text-sm text-brand-700 mb-2">
              {customer.kycStatus === 'NOT_SUBMITTED' && 'Complete KYC to unlock full account features.'}
              {customer.kycStatus === 'SUBMITTED' && 'Your KYC documents are under review.'}
              {customer.kycStatus === 'MORE_DOCS_NEEDED' && (
                <>More documents are needed: <i className="text-rose-700">{customer.kycRejectionReason}</i></>
              )}
              {customer.kycStatus === 'REJECTED' && (
                <>KYC was rejected: <i className="text-rose-700">{customer.kycRejectionReason}</i></>
              )}
            </p>
            <Link href="/account/kyc" className="btn-primary text-sm">
              {customer.kycStatus === 'NOT_SUBMITTED' ? 'Start KYC →' : 'Manage KYC documents →'}
            </Link>
          </div>
        )}
      </div>

      <div>
        <h2 className="font-serif text-xl mb-3">Recent enquiries</h2>
        {enquiries.length === 0 ? (
          <div className="card p-6 text-brand-700 text-sm">No enquiries yet.</div>
        ) : (
          <div className="space-y-3">
            {enquiries.map(eq => (
              <div key={eq.id} className="card p-4">
                <div className="flex justify-between text-sm">
                  <div className="text-brand-700">
                    {new Date(eq.createdAt).toLocaleString()} · {eq.items.length} stone(s)
                  </div>
                  <span className="badge-gray">{eq.status}</span>
                </div>
                <ul className="mt-2 text-sm space-y-1">
                  {eq.items.map(it => (
                    <li key={it.id} className="text-brand-900">
                      <span className="font-mono text-xs text-brand-700">{it.diamond.stoneId}</span>{' '}
                      {it.diamond.shape} · {fmtCarat(it.diamond.carat as any)}ct · {it.diamond.color} {it.diamond.clarity}
                      <span className="float-right">{fmtUsd(it.totalPrice as any)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
