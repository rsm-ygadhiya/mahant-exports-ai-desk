'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtUsd } from '@/lib/format';

type Payment = {
  id: string; amount: number; method: string; status: string;
  transactionRef: string | null; notes: string | null;
  rejectionReason: string | null;
  recordedAt: string; confirmedAt: string | null;
};

const PILL: Record<string, string> = {
  CONFIRMED:             'badge-green',
  PENDING_CASH_APPROVAL: 'badge-amber',
  REJECTED:              'badge-red',
};

export function PaymentRow({ payment, canApproveCash }: { payment: Payment; canApproveCash: boolean }) {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);

  async function approve() {
    setError(null);
    if (token.length !== 6) { setError('Enter the 6-digit code.'); return; }
    setBusy(true);
    const res = await fetch(`/api/admin/payments/${payment.id}/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) { setError(body.error ?? 'Failed.'); return; }
    setToken('');
    router.refresh();
  }

  async function reject() {
    if (reason.trim().length < 3) { setError('Reason required.'); return; }
    setBusy(true);
    const res = await fetch(`/api/admin/payments/${payment.id}/reject`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(body.error ?? 'Failed.'); return; }
    setShowReject(false); setReason('');
    router.refresh();
  }

  return (
    <>
      <tr className="border-t border-brand-100 align-top">
        <td className="px-3 py-2 text-xs">{new Date(payment.recordedAt).toLocaleString()}</td>
        <td className="px-3 py-2 text-xs">{payment.method}</td>
        <td className="px-3 py-2 text-right font-medium">{fmtUsd(payment.amount)}</td>
        <td className="px-3 py-2 text-xs">
          {payment.transactionRef && <div className="font-mono">{payment.transactionRef}</div>}
          {payment.notes && <div className="text-brand-700">{payment.notes}</div>}
          {payment.rejectionReason && <div className="text-rose-700">Rejected: {payment.rejectionReason}</div>}
        </td>
        <td className="px-3 py-2">
          <span className={PILL[payment.status] ?? 'badge-gray'}>{payment.status.replace('_', ' ')}</span>
          {payment.confirmedAt && (
            <div className="text-xs text-brand-700 mt-0.5">{new Date(payment.confirmedAt).toLocaleString()}</div>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          {payment.status === 'PENDING_CASH_APPROVAL' && canApproveCash && (
            <div className="flex flex-col items-end gap-1">
              <div className="flex gap-1">
                <input value={token} onChange={e => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                       placeholder="6-digit code"
                       className="input max-w-[110px] text-right font-mono text-sm" />
                <button onClick={approve} disabled={busy} className="text-xs btn-gold">Approve</button>
              </div>
              <button onClick={() => setShowReject(s => !s)} className="text-xs text-rose-700 hover:underline">
                {showReject ? 'Cancel reject' : 'Reject…'}
              </button>
              {error && <span className="text-rose-700 text-xs">{error}</span>}
            </div>
          )}
          {payment.status === 'PENDING_CASH_APPROVAL' && !canApproveCash && (
            <span className="text-xs text-brand-700/60">Awaiting Accounts</span>
          )}
        </td>
      </tr>
      {showReject && (
        <tr className="border-t border-brand-100 bg-rose-50/30">
          <td colSpan={6} className="px-3 py-2">
            <div className="flex gap-2 items-start">
              <input value={reason} onChange={e => setReason(e.target.value)}
                     placeholder="Why are you rejecting this cash payment?"
                     className="input text-sm flex-1" />
              <button onClick={reject} disabled={busy} className="text-xs btn-outline">
                Confirm reject
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
