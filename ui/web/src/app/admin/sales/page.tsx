import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getCurrentAdmin } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { fmtUsd } from '@/lib/format';
import { derivePaymentStatus } from '@/lib/orders';
import { Pagination } from '@/components/Pagination';

export const dynamic = 'force-dynamic';

const PAYMENT_TABS = ['ALL', 'UNPAID', 'PARTIAL', 'PAID', 'OVERDUE'] as const;
const ORDER_TABS   = ['ALL', 'DRAFT', 'CONFIRMED', 'CANCELLED'] as const;

export default async function SalesPage({
  searchParams,
}: { searchParams: Record<string, string | string[] | undefined> }) {
  const me = await getCurrentAdmin();
  if (!me || !hasPermission(me as any, 'sales', 'view')) {
    return <div className="card p-6 text-sm text-brand-700">No access to Sales.</div>;
  }

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === 'string') sp.set(k, v);
  }
  const customerQ = sp.get('customer') ?? '';
  const orderStatus = sp.get('order_status') ?? '';
  const paymentStatus = sp.get('payment_status') ?? '';
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const pageSize = Math.min(200, Math.max(10, Number(sp.get('pageSize')) || 50));

  const where: any = {};
  if (orderStatus && (ORDER_TABS as readonly string[]).includes(orderStatus) && orderStatus !== 'ALL') {
    where.status = orderStatus;
  }
  if (customerQ) {
    where.customer = {
      OR: [
        { companyName: { contains: customerQ, mode: 'insensitive' } },
        { contactPerson: { contains: customerQ, mode: 'insensitive' } },
        { uniqueCode: { contains: customerQ, mode: 'insensitive' } },
        { mobile: { contains: customerQ } },
      ],
    };
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        customer: { select: { companyName: true, uniqueCode: true, contactPerson: true } },
        items: true,
        payments: { select: { amount: true, status: true } },
        _count: { select: { items: true, payments: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.order.count({ where }),
  ]);

  // Derive payment status post-fetch and apply paymentStatus filter in memory
  // (it's not a stored column).
  let rows = orders.map(o => {
    const pay = derivePaymentStatus(o as any);
    return { o, pay };
  });
  if (paymentStatus && (PAYMENT_TABS as readonly string[]).includes(paymentStatus) && paymentStatus !== 'ALL') {
    rows = rows.filter(r => r.pay.status === paymentStatus);
  }

  // Top-line totals across the (unfiltered-for-payment) result set.
  const totalRevenueAgg = await prisma.order.aggregate({
    where: { status: 'CONFIRMED' },
    _sum: { totalAmount: true },
  });
  const pendingCashCount = await prisma.payment.count({ where: { status: 'PENDING_CASH_APPROVAL' } });

  const linkFor = (overrides: Record<string, string>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(overrides)) {
      if (v) next.set(k, v); else next.delete(k);
    }
    next.delete('page'); // reset paging on filter change
    const qs = next.toString();
    return '/admin/sales' + (qs ? `?${qs}` : '');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-serif text-3xl">Sales &amp; Orders</h1>
          <p className="text-sm text-brand-700">{total.toLocaleString()} order{total === 1 ? '' : 's'} · {fmtUsd(Number(totalRevenueAgg._sum.totalAmount ?? 0))} confirmed lifetime</p>
        </div>
        <div className="flex gap-2">
          {pendingCashCount > 0 && hasPermission(me as any, 'cash', 'approve') && (
            <Link href="/admin/sales?payment_status=UNPAID" className="btn-gold">
              💵 {pendingCashCount} cash payment{pendingCashCount === 1 ? '' : 's'} await approval
            </Link>
          )}
          {hasPermission(me as any, 'sales', 'edit') && (
            <Link href="/admin/sales/new" className="btn-primary">＋ New order</Link>
          )}
        </div>
      </div>

      <div className="card p-3 space-y-2 text-sm">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs uppercase tracking-widest text-brand-700">Order status:</span>
          {ORDER_TABS.map(s => (
            <Link key={s} href={linkFor({ order_status: s === 'ALL' ? '' : s })}
                  className={(s === 'ALL' && !orderStatus) || orderStatus === s ? 'btn-primary' : 'btn-outline'}>
              {s}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs uppercase tracking-widest text-brand-700">Payment:</span>
          {PAYMENT_TABS.map(s => (
            <Link key={s} href={linkFor({ payment_status: s === 'ALL' ? '' : s })}
                  className={(s === 'ALL' && !paymentStatus) || paymentStatus === s ? 'btn-primary' : 'btn-outline'}>
              {s}
            </Link>
          ))}
        </div>
        <form action="/admin/sales" className="flex gap-2 items-center pt-1">
          <span className="text-xs uppercase tracking-widest text-brand-700">Customer:</span>
          <input name="customer" defaultValue={customerQ}
                 placeholder="Company / contact / CUST-2026-… / mobile"
                 className="input max-w-[260px] text-sm" />
          {orderStatus && <input type="hidden" name="order_status" value={orderStatus} />}
          {paymentStatus && <input type="hidden" name="payment_status" value={paymentStatus} />}
          <button className="btn-outline text-xs">Filter</button>
          {customerQ && <Link href={linkFor({ customer: '' })} className="text-xs text-brand-700 hover:underline">Clear</Link>}
        </form>
      </div>

      <Pagination total={total} page={page} pageSize={pageSize}
                  basePath="/admin/sales" searchParams={sp} />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-brand-50 text-brand-700 text-left">
            <tr>
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2 text-right">Stones</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Paid</th>
              <th className="px-3 py-2">Payment</th>
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ o, pay }) => (
              <tr key={o.id} className="border-t border-brand-100">
                <td className="px-3 py-2 font-mono text-xs">{o.orderCode}</td>
                <td className="px-3 py-2">
                  <div className="font-medium">{o.customer.companyName}</div>
                  <div className="text-xs text-brand-700">{o.customer.contactPerson}{o.customer.uniqueCode && <> · <span className="font-mono text-gold-700">{o.customer.uniqueCode}</span></>}</div>
                </td>
                <td className="px-3 py-2 text-right">{o._count.items}</td>
                <td className="px-3 py-2 text-right font-medium">{fmtUsd(Number(o.totalAmount))}</td>
                <td className="px-3 py-2 text-right">{fmtUsd(pay.paid)}</td>
                <td className="px-3 py-2"><PaymentPill status={pay.status} /></td>
                <td className="px-3 py-2"><OrderPill status={o.status} /></td>
                <td className="px-3 py-2 text-xs">{new Date(o.createdAt).toLocaleDateString()}</td>
                <td className="px-3 py-2 text-right">
                  <Link href={`/admin/sales/${o.id}`} className="text-xs text-gold-600 hover:underline">Open →</Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={9} className="text-center py-12 text-brand-700">No orders match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination total={total} page={page} pageSize={pageSize}
                  basePath="/admin/sales" searchParams={sp} />
    </div>
  );
}

function OrderPill({ status }: { status: string }) {
  const cls = status === 'CONFIRMED' ? 'badge-green'
            : status === 'DRAFT'     ? 'badge-amber'
            : 'badge-red';
  return <span className={cls}>{status}</span>;
}

function PaymentPill({ status }: { status: string }) {
  const cls = status === 'PAID'    ? 'badge-green'
            : status === 'PARTIAL' ? 'badge-amber'
            : status === 'OVERDUE' ? 'badge-red'
            : 'badge-gray';
  return <span className={cls}>{status}</span>;
}
