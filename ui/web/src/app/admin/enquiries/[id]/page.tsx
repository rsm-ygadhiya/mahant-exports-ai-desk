import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCurrentAdmin } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { fmtCarat, fmtUsd } from '@/lib/format';
import { EnquiryActions } from './EnquiryActions';

export const dynamic = 'force-dynamic';

export default async function EnquiryDetailPage({ params }: { params: { id: string } }) {
  const me = await getCurrentAdmin();
  if (!me || !hasPermission(me as any, 'enquiries', 'view')) {
    return <div className="card p-6 text-sm text-brand-700">No access.</div>;
  }

  const enquiry = await prisma.enquiry.findUnique({
    where: { id: params.id },
    include: {
      customer: { include: { pricingRule: true } },
      items: { include: { diamond: true } },
      order: true,
    },
  });
  if (!enquiry) return notFound();

  // Real CLV = sum of CONFIRMED orders for this customer.
  const orders = await prisma.order.findMany({
    where: { customerId: enquiry.customerId, status: 'CONFIRMED' },
    select: { totalAmount: true, createdAt: true },
  });
  const clv = orders.reduce((s, o) => s + Number(o.totalAmount), 0);

  // Load the templates so the action panels can show editable defaults.
  const [tplMemo, tplSale, tplCancel] = await Promise.all([
    prisma.messageTemplate.findUnique({ where: { key: 'enquiry.memo_approved' } }),
    prisma.messageTemplate.findUnique({ where: { key: 'enquiry.sale_confirmed' } }),
    prisma.messageTemplate.findUnique({ where: { key: 'enquiry.cancelled' } }),
  ]);

  const enquiryTotal = enquiry.items.reduce((s, it) => s + Number(it.totalPrice ?? 0), 0);
  const canAct = hasPermission(me as any, 'enquiries', 'approve');
  const terminal =
    enquiry.status === 'APPROVED_MEMO' ||
    enquiry.status === 'APPROVED_SALE' ||
    enquiry.status === 'CANCELLED';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href="/admin/enquiries" className="text-xs text-brand-700 hover:underline">← All enquiries</Link>
          <h1 className="font-serif text-3xl mt-2">Enquiry</h1>
          <p className="text-xs text-brand-700 font-mono mt-1">{enquiry.id}</p>
        </div>
        <div className="text-right">
          <StatusPill status={enquiry.status} />
          <p className="text-xs text-brand-700 mt-1">
            Received {new Date(enquiry.createdAt).toLocaleString()}
            {enquiry.decidedAt && <><br/>Decided {new Date(enquiry.decidedAt).toLocaleString()}</>}
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="card p-4 md:col-span-2 space-y-2">
          <div className="text-xs uppercase tracking-widest text-brand-700">Customer</div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <Link href={`/admin/customers/${enquiry.customer.id}`} className="font-serif text-xl hover:text-gold-600 hover:underline">
              {enquiry.customer.companyName}
            </Link>
            {enquiry.customer.uniqueCode && (
              <span className="font-mono text-sm text-gold-700">{enquiry.customer.uniqueCode}</span>
            )}
            <span className={`badge-${enquiry.customer.status === 'APPROVED' ? 'green' : 'amber'}`}>{enquiry.customer.status}</span>
            <KycPill status={enquiry.customer.kycStatus} />
          </div>
          <div className="text-sm text-brand-700">
            {enquiry.customer.contactPerson} · {enquiry.customer.mobile}
            {enquiry.customer.email && <> · {enquiry.customer.email}</>}
            {(enquiry.customer.city || enquiry.customer.country) && <> · {[enquiry.customer.city, enquiry.customer.country].filter(Boolean).join(', ')}</>}
          </div>
          <div className="text-xs text-brand-700">
            Pricing tier: <b>{enquiry.customer.pricingRule?.mode ?? 'BASE'}</b>
            {enquiry.customer.pricingRule?.adjustPct != null && <> ({Number(enquiry.customer.pricingRule.adjustPct).toFixed(2)}%)</>}
          </div>
        </div>

        <div className="card p-4">
          <div className="text-xs uppercase tracking-widest text-brand-700">Customer lifetime value</div>
          <div className="font-serif text-3xl mt-1 text-emerald-700">{fmtUsd(clv)}</div>
          <div className="text-xs text-brand-700 mt-1">From {orders.length} confirmed order{orders.length === 1 ? '' : 's'}</div>
        </div>
      </div>

      {enquiry.message && (
        <div className="card p-4 bg-brand-50/40">
          <div className="text-xs uppercase tracking-widest text-brand-700 mb-1">Buyer's message</div>
          <p className="text-sm whitespace-pre-wrap text-brand-900">{enquiry.message}</p>
        </div>
      )}

      <div className="card p-6">
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-serif text-xl">Stones requested</h2>
          <div className="text-right">
            <div className="text-xs uppercase tracking-widest text-brand-700">Enquiry total</div>
            <div className="font-serif text-2xl">{fmtUsd(enquiryTotal)}</div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-brand-50 text-brand-700 text-left">
              <tr>
                <th className="px-3 py-2">Stone</th>
                <th className="px-3 py-2">Spec</th>
                <th className="px-3 py-2">Lab / Cert</th>
                <th className="px-3 py-2">Current status</th>
                <th className="px-3 py-2 text-right">$/ct (snapshot)</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {enquiry.items.map(it => (
                <tr key={it.id} className="border-t border-brand-100">
                  <td className="px-3 py-2 font-mono text-xs">{it.diamond.stoneId}</td>
                  <td className="px-3 py-2 text-xs">{it.diamond.shape} {fmtCarat(it.diamond.carat as any)} {it.diamond.color}/{it.diamond.clarity}</td>
                  <td className="px-3 py-2 text-xs">{it.diamond.lab} {it.diamond.certificateNo}</td>
                  <td className="px-3 py-2 text-xs">{it.diamond.status}</td>
                  <td className="px-3 py-2 text-right">{fmtUsd(Number(it.pricePerCarat))}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtUsd(Number(it.totalPrice))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Decided / terminal-state info */}
      {enquiry.status === 'APPROVED_MEMO' && (
        <div className="card p-4 bg-emerald-50/40 border-emerald-200 text-sm">
          <b>On memo</b> — pickup at <b>{enquiry.memoLocation}</b> by <b>{enquiry.memoPickupAt && new Date(enquiry.memoPickupAt).toLocaleString()}</b>
        </div>
      )}
      {enquiry.status === 'APPROVED_SALE' && enquiry.order && (
        <div className="card p-4 bg-emerald-50/40 border-emerald-200 text-sm flex items-center justify-between">
          <span><b>Confirmed as order</b> <span className="font-mono">{enquiry.order.orderCode}</span></span>
          <Link href={`/admin/sales/${enquiry.order.id}`} className="text-gold-700 hover:underline">Open order →</Link>
        </div>
      )}
      {enquiry.status === 'CANCELLED' && (
        <div className="card p-4 bg-rose-50/40 border-rose-200 text-sm">
          <b>Cancelled.</b> Reason: <i>{enquiry.cancellationReason}</i>
        </div>
      )}

      {canAct && !terminal && (
        <EnquiryActions
          enquiryId={enquiry.id}
          customerName={enquiry.customer.contactPerson}
          stonesList={enquiry.items.map(it => `• ${it.diamond.stoneId} — ${it.diamond.shape} ${Number(it.diamond.carat).toFixed(2)}ct ${it.diamond.color}/${it.diamond.clarity}`).join('\n')}
          totalAmount={fmtUsd(enquiryTotal)}
          memoTemplate={{ subject: tplMemo?.subject ?? '', body: tplMemo?.body ?? '' }}
          saleTemplate={{ subject: tplSale?.subject ?? '', body: tplSale?.body ?? '' }}
          cancelTemplate={{ subject: tplCancel?.subject ?? '', body: tplCancel?.body ?? '' }}
        />
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls: Record<string, string> = {
    NEW: 'badge-amber', CONTACTED: 'badge-amber',
    APPROVED_MEMO: 'badge-green', APPROVED_SALE: 'badge-green',
    CANCELLED: 'badge-red', CLOSED: 'badge-gray',
  };
  return <span className={cls[status] ?? 'badge-gray'}>{status.replace('_', ' ')}</span>;
}

function KycPill({ status }: { status: string }) {
  const cls: Record<string, string> = {
    NOT_SUBMITTED: 'badge-gray',
    SUBMITTED: 'badge-amber',
    MORE_DOCS_NEEDED: 'badge-amber',
    APPROVED: 'badge-green',
    REJECTED: 'badge-red',
  };
  return <span className={cls[status] ?? 'badge-gray'}>KYC: {status.replace('_', ' ').toLowerCase()}</span>;
}
