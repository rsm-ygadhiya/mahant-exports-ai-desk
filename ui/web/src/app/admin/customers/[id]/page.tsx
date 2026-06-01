import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCurrentAdmin } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { fmtCarat, fmtUsd } from '@/lib/format';
import { CustomerProfileActions } from './ProfileActions';

export const dynamic = 'force-dynamic';

export default async function CustomerProfilePage({ params }: { params: { id: string } }) {
  const me = await getCurrentAdmin();
  if (!me) return null;
  if (!hasPermission(me as any, 'customers', 'view')) {
    return <div className="card p-6 text-sm text-brand-700">You don't have permission to view customers.</div>;
  }

  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
    include: {
      pricingRule: true,
      documents: {
        orderBy: { uploadedAt: 'desc' },
        select: { id: true, kind: true, label: true, filename: true, mimeType: true, sizeBytes: true, uploadedAt: true },
      },
      enquiries: {
        orderBy: { createdAt: 'desc' },
        include: { items: { include: { diamond: true } } },
      },
    },
  });
  if (!customer) return notFound();

  // Memo history — stones currently or previously held that this customer enquired on.
  const stoneIdsFromEnquiries = customer.enquiries.flatMap(eq => eq.items.map(it => it.diamondId));
  const memoHistory = stoneIdsFromEnquiries.length
    ? await prisma.diamond.findMany({
        where: { id: { in: stoneIdsFromEnquiries }, status: { in: ['HOLD', 'SOLD'] } },
        orderBy: { updatedAt: 'desc' },
      })
    : [];

  // Lightweight CLV estimate from enquiry value (we have no real Orders yet — that's P4).
  const enquiryValue = customer.enquiries.reduce(
    (sum, eq) => sum + eq.items.reduce((s, it) => s + Number(it.totalPrice ?? 0), 0),
    0,
  );

  const canEdit = hasPermission(me as any, 'customers', 'edit');
  const canApprove = hasPermission(me as any, 'customers', 'approve');

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/admin/customers" className="text-xs text-brand-700 hover:underline">← All customers</Link>
          <h1 className="font-serif text-3xl mt-2">{customer.companyName}</h1>
          <p className="text-sm text-brand-700">
            {customer.contactPerson} · {customer.mobile}
            {customer.email && <> · {customer.email}</>}
            {customer.country && <> · {[customer.city, customer.country].filter(Boolean).join(', ')}</>}
          </p>
          {customer.uniqueCode && (
            <p className="font-mono text-sm text-gold-700 mt-1">{customer.uniqueCode}</p>
          )}
        </div>
        <div className="text-right">
          <div className="space-x-2">
            <StatusBadge status={customer.status} />
            <KycPill status={customer.kycStatus} />
          </div>
          <p className="text-xs text-brand-700 mt-1">Joined {new Date(customer.createdAt).toLocaleDateString()}</p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <Kpi label="Enquiry value (lifetime)" value={fmtUsd(enquiryValue)} sub={`${customer.enquiries.length} enquiries`} />
        <Kpi label="On memo" value={memoHistory.filter(d => d.status === 'HOLD').length} />
        <Kpi label="Sold to this customer" value={memoHistory.filter(d => d.status === 'SOLD').length} />
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-serif text-xl">KYC Documents</h2>
          {customer.kycRejectionReason && (
            <span className="text-xs text-rose-700 italic">Last note: {customer.kycRejectionReason}</span>
          )}
        </div>
        {customer.documents.length === 0 ? (
          <p className="text-sm text-brand-700">No documents uploaded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-brand-50 text-brand-700 text-left">
                <tr>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Label</th>
                  <th className="px-3 py-2">File</th>
                  <th className="px-3 py-2">Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {customer.documents.map(d => (
                  <tr key={d.id} className="border-t border-brand-100">
                    <td className="px-3 py-2"><span className="badge-gray">{d.kind}</span></td>
                    <td className="px-3 py-2">{d.label}</td>
                    <td className="px-3 py-2 text-xs">
                      <a href={`/api/admin/customer-documents/${d.id}`} target="_blank"
                         className="text-gold-600 hover:underline">
                        {d.filename}
                      </a>
                      <div className="text-brand-700/60">{(d.sizeBytes / 1024).toFixed(1)} KB · {d.mimeType}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">{new Date(d.uploadedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canApprove && (
          <div className="mt-4 border-t border-brand-100 pt-4">
            <CustomerProfileActions
              customerId={customer.id}
              kycStatus={customer.kycStatus}
              hasDocs={customer.documents.length > 0}
            />
          </div>
        )}
      </div>

      <div className="card p-6">
        <h2 className="font-serif text-xl mb-3">Memo / Sold history</h2>
        {memoHistory.length === 0 ? (
          <p className="text-sm text-brand-700">No memo or sold record yet for this customer.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-brand-50 text-brand-700 text-left">
                <tr>
                  <th className="px-3 py-2">Stone</th>
                  <th className="px-3 py-2">Spec</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {memoHistory.slice(0, 50).map(d => (
                  <tr key={d.id} className="border-t border-brand-100">
                    <td className="px-3 py-2 font-mono text-xs">{d.stoneId}</td>
                    <td className="px-3 py-2 text-xs">{d.shape} {fmtCarat(d.carat as any)} {d.color}/{d.clarity}</td>
                    <td className="px-3 py-2 text-right">{fmtUsd(d.totalPrice as any)}</td>
                    <td className="px-3 py-2"><StatusBadge status={d.status} /></td>
                    <td className="px-3 py-2 text-xs">{new Date(d.updatedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card p-6">
        <h2 className="font-serif text-xl mb-3">Enquiry history</h2>
        {customer.enquiries.length === 0 ? (
          <p className="text-sm text-brand-700">No enquiries yet.</p>
        ) : (
          <div className="space-y-2 text-sm">
            {customer.enquiries.slice(0, 20).map(eq => (
              <div key={eq.id} className="flex justify-between border-b border-brand-100 py-2">
                <div>
                  <span className="text-brand-700">{new Date(eq.createdAt).toLocaleDateString()} · </span>
                  <span>{eq.items.length} stone(s)</span>
                  {eq.message && <span className="text-brand-700 italic"> — "{eq.message}"</span>}
                </div>
                <div>
                  <span className="badge-gray">{eq.status}</span>
                  <span className="ml-2">{fmtUsd(eq.items.reduce((s, it) => s + Number(it.totalPrice ?? 0), 0))}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'AVAILABLE' || status === 'APPROVED' ? 'badge-green'
            : status === 'PENDING'   || status === 'HOLD'     ? 'badge-amber'
            : 'badge-red';
  return <span className={cls}>{status}</span>;
}

function KycPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    NOT_SUBMITTED: 'badge-gray',
    SUBMITTED: 'badge-amber',
    MORE_DOCS_NEEDED: 'badge-amber',
    APPROVED: 'badge-green',
    REJECTED: 'badge-red',
  };
  return <span className={map[status] ?? 'badge-gray'}>KYC: {status.replace('_', ' ').toLowerCase()}</span>;
}

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-widest text-brand-700">{label}</div>
      <div className="text-2xl font-serif mt-1">{value}</div>
      {sub && <div className="text-xs text-brand-700 mt-1">{sub}</div>}
    </div>
  );
}
