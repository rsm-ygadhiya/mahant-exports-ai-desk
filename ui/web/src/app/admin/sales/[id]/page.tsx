import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCurrentAdmin } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { fmtCarat, fmtUsd } from '@/lib/format';
import { derivePaymentStatus } from '@/lib/orders';
import { OrderActions } from './OrderActions';
import { PaymentRecorder } from './PaymentRecorder';
import { PaymentRow } from './PaymentRow';

export const dynamic = 'force-dynamic';

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  const me = await getCurrentAdmin();
  if (!me || !hasPermission(me as any, 'sales', 'view')) {
    return <div className="card p-6 text-sm text-brand-700">No access.</div>;
  }

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: {
      customer: true,
      items: { include: { diamond: true } },
      payments: { orderBy: { recordedAt: 'desc' } },
    },
  });
  if (!order) return notFound();

  const pay = derivePaymentStatus(order as any);
  const canEdit       = hasPermission(me as any, 'sales', 'edit');
  const canApproveCash = hasPermission(me as any, 'cash', 'approve');

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href="/admin/sales" className="text-xs text-brand-700 hover:underline">← All orders</Link>
          <h1 className="font-serif text-3xl mt-2">Order <span className="font-mono">{order.orderCode}</span></h1>
          <p className="text-sm text-brand-700">
            <Link href={`/admin/customers/${order.customer.id}`} className="hover:underline">
              {order.customer.companyName}
            </Link>
            {' '}· {order.customer.contactPerson} · {order.customer.mobile}
            {order.customer.uniqueCode && <> · <span className="font-mono text-gold-700">{order.customer.uniqueCode}</span></>}
          </p>
        </div>
        <div className="text-right space-y-1">
          <div>
            <span className={order.status === 'CONFIRMED' ? 'badge-green' : order.status === 'DRAFT' ? 'badge-amber' : 'badge-red'}>
              {order.status}
            </span>
            <span className={`ml-2 ${pay.status === 'PAID' ? 'badge-green' : pay.status === 'OVERDUE' ? 'badge-red' : pay.status === 'PARTIAL' ? 'badge-amber' : 'badge-gray'}`}>
              {pay.status}
            </span>
          </div>
          <p className="text-xs text-brand-700">
            Created {new Date(order.createdAt).toLocaleString()}
            {order.dueDate && <> · Due {new Date(order.dueDate).toLocaleDateString()}</>}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Total" value={fmtUsd(Number(order.totalAmount))} />
        <Kpi label="Paid" value={fmtUsd(pay.paid)} tone="green" />
        <Kpi label="Outstanding" value={fmtUsd(pay.outstanding)} tone={pay.outstanding > 0 ? 'amber' : 'green'} />
        <Kpi label="Stones" value={order.items.length} />
      </div>

      <div className="card p-6 space-y-3">
        <h2 className="font-serif text-xl">Stones in this order</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-brand-50 text-brand-700 text-left">
              <tr>
                <th className="px-3 py-2">Stone</th>
                <th className="px-3 py-2">Spec</th>
                <th className="px-3 py-2">Lab / Cert</th>
                <th className="px-3 py-2 text-right">$/ct (snapshot)</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map(it => (
                <tr key={it.id} className="border-t border-brand-100">
                  <td className="px-3 py-2 font-mono text-xs">{it.diamond.stoneId}</td>
                  <td className="px-3 py-2 text-xs">{it.diamond.shape} {fmtCarat(it.diamond.carat as any)} {it.diamond.color}/{it.diamond.clarity}</td>
                  <td className="px-3 py-2 text-xs">{it.diamond.lab} {it.diamond.certificateNo}</td>
                  <td className="px-3 py-2 text-right">{fmtUsd(Number(it.pricePerCarat))}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtUsd(Number(it.totalPrice))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-brand-200">
                <td colSpan={4} className="px-3 py-2 text-right text-brand-700 text-xs uppercase tracking-widest">Order total</td>
                <td className="px-3 py-2 text-right font-medium">{fmtUsd(Number(order.totalAmount))}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {canEdit && order.status !== 'CANCELLED' && (
          <OrderActions orderId={order.id} status={order.status} />
        )}
        {order.notes && (
          <div className="text-xs text-brand-700 whitespace-pre-wrap border-t border-brand-100 pt-2">
            <b className="uppercase tracking-widest">Notes:</b> {order.notes}
          </div>
        )}
      </div>

      <div className="card p-6 space-y-3">
        <h2 className="font-serif text-xl">Payments</h2>

        {canEdit && order.status === 'CONFIRMED' && pay.outstanding > 0 && (
          <PaymentRecorder orderId={order.id} outstanding={pay.outstanding} />
        )}

        {order.payments.length === 0 ? (
          <p className="text-sm text-brand-700">No payments recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-brand-50 text-brand-700 text-left">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Method</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Ref / Notes</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {order.payments.map(p => (
                  <PaymentRow key={p.id} payment={{
                    id: p.id, amount: Number(p.amount), method: p.method, status: p.status,
                    transactionRef: p.transactionRef, notes: p.notes,
                    rejectionReason: p.rejectionReason,
                    recordedAt: p.recordedAt.toISOString(),
                    confirmedAt: p.confirmedAt?.toISOString() ?? null,
                  }} canApproveCash={canApproveCash} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: 'green' | 'amber' | 'rose' }) {
  const cls = tone === 'green' ? 'text-emerald-700'
            : tone === 'amber' ? 'text-amber-700'
            : tone === 'rose'  ? 'text-rose-700' : 'text-brand-900';
  return (
    <div className="card p-3">
      <div className="text-xs uppercase tracking-widest text-brand-700">{label}</div>
      <div className={`text-2xl font-serif mt-0.5 ${cls}`}>{value}</div>
    </div>
  );
}
