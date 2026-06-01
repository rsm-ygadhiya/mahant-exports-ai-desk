'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Customer, PricingRule, CustomerStatus, KycStatus, PricingMode } from '@prisma/client';

type Row = Customer & {
  pricingRule: PricingRule | null;
  _count: { enquiries: number; documents: number };
};

const STATUS_CLS: Record<CustomerStatus, string> = {
  PENDING: 'badge-amber', APPROVED: 'badge-green', REJECTED: 'badge-red', SUSPENDED: 'badge-red',
};

const KYC_CLS: Record<KycStatus, string> = {
  NOT_SUBMITTED: 'badge-gray',
  SUBMITTED: 'badge-amber',
  MORE_DOCS_NEEDED: 'badge-amber',
  APPROVED: 'badge-green',
  REJECTED: 'badge-red',
};

const KYC_LABEL: Record<KycStatus, string> = {
  NOT_SUBMITTED: 'Not submitted',
  SUBMITTED: 'Under review',
  MORE_DOCS_NEEDED: 'More docs needed',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

export function CustomerRow({ customer }: { customer: Row }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<PricingMode>(customer.pricingRule?.mode ?? 'BASE');
  const [adjustPct, setAdjustPct] = useState<string>(customer.pricingRule?.adjustPct?.toString() ?? '');
  const [busy, setBusy] = useState(false);

  async function setStatus(status: CustomerStatus) {
    setBusy(true);
    await fetch(`/api/admin/customers/${customer.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setBusy(false);
    router.refresh();
  }

  async function savePricing() {
    setBusy(true);
    await fetch(`/api/admin/customers/${customer.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pricingRule: {
          mode,
          adjustPct: mode === 'ADJUST_PCT' ? Number(adjustPct) : null,
        },
      }),
    });
    setBusy(false);
    setEditing(false);
    router.refresh();
  }

  return (
    <tr className="border-t border-brand-100 align-top">
      <td className="px-3 py-2 font-mono text-xs">
        {customer.uniqueCode
          ? <span className="text-gold-700">{customer.uniqueCode}</span>
          : <span className="text-brand-700/40">—</span>}
      </td>
      <td className="px-3 py-2">
        <Link href={`/admin/customers/${customer.id}`} className="font-medium hover:text-gold-600 hover:underline">
          {customer.companyName}
        </Link>
        <div className="text-xs text-brand-700">{customer.country} {customer.city}</div>
      </td>
      <td className="px-3 py-2">{customer.contactPerson}</td>
      <td className="px-3 py-2">
        <div>{customer.mobile}</div>
        <div className="text-xs text-brand-700">{customer.email ?? '—'}</div>
      </td>
      <td className="px-3 py-2">
        <span className={STATUS_CLS[customer.status]}>{customer.status}</span>
        <div className="mt-1 flex flex-col gap-1 text-xs">
          {customer.status !== 'APPROVED' && <button onClick={() => setStatus('APPROVED')} disabled={busy} className="text-emerald-700 hover:underline">Approve</button>}
          {customer.status !== 'REJECTED' && <button onClick={() => setStatus('REJECTED')} disabled={busy} className="text-rose-700 hover:underline">Reject</button>}
          {customer.status === 'APPROVED' && <button onClick={() => setStatus('SUSPENDED')} disabled={busy} className="text-rose-700 hover:underline">Suspend</button>}
        </div>
      </td>
      <td className="px-3 py-2">
        <span className={KYC_CLS[customer.kycStatus]}>{KYC_LABEL[customer.kycStatus]}</span>
        {customer.kycSubmittedAt && customer.kycStatus !== 'NOT_SUBMITTED' && (
          <div className="text-xs text-brand-700 mt-0.5">
            since {new Date(customer.kycSubmittedAt).toLocaleDateString()}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        {!editing ? (
          <div className="text-xs">
            <div>{customer.pricingRule?.mode ?? 'BASE'}{customer.pricingRule?.mode === 'ADJUST_PCT' ? ` (${customer.pricingRule.adjustPct}%)` : ''}</div>
            <button onClick={() => setEditing(true)} className="text-brand-700 underline">Edit</button>
          </div>
        ) : (
          <div className="space-y-1 text-xs">
            <select value={mode} onChange={e => setMode(e.target.value as PricingMode)} className="input">
              <option value="BASE">Base</option>
              <option value="ADJUST_PCT">Adjust %</option>
              <option value="HIDDEN">Hidden</option>
            </select>
            {mode === 'ADJUST_PCT' && (
              <input value={adjustPct} onChange={e => setAdjustPct(e.target.value)}
                     placeholder="e.g. -2.5" className="input" />
            )}
            <div className="flex gap-2">
              <button onClick={savePricing} disabled={busy} className="text-emerald-700 underline">Save</button>
              <button onClick={() => setEditing(false)} className="text-brand-700">Cancel</button>
            </div>
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right text-xs">{customer._count.documents}</td>
      <td className="px-3 py-2 text-right">{customer._count.enquiries}</td>
      <td className="px-3 py-2 text-right">
        <Link href={`/admin/customers/${customer.id}`} className="text-xs text-gold-600 hover:underline whitespace-nowrap">
          Open →
        </Link>
      </td>
    </tr>
  );
}
