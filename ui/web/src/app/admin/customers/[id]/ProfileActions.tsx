'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type KycStatus = 'NOT_SUBMITTED' | 'SUBMITTED' | 'MORE_DOCS_NEEDED' | 'APPROVED' | 'REJECTED';

export function CustomerProfileActions({
  customerId, kycStatus, hasDocs,
}: { customerId: string; kycStatus: KycStatus; hasDocs: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'reject' | 'request_more_docs' | null>(null);
  const [reason, setReason] = useState('');

  async function approve() {
    if (!confirm('Approve KYC and issue a unique customer ID? They will be notified.')) return;
    setBusy(true); setError(null);
    const res = await fetch(`/api/admin/customers/${customerId}/kyc`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) { setError(body.error ?? `Failed (${res.status})`); return; }
    alert(`Approved. Customer ID: ${body.customer.uniqueCode}`);
    router.refresh();
  }

  async function submitWithReason() {
    if (!pending) return;
    if (reason.trim().length < 3) { setError('Reason is required.'); return; }
    setBusy(true); setError(null);
    const res = await fetch(`/api/admin/customers/${customerId}/kyc`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: pending, reason: reason.trim() }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) { setError(body.error ?? `Failed (${res.status})`); return; }
    setPending(null); setReason('');
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 items-center">
        <button onClick={approve}
                disabled={busy || kycStatus === 'APPROVED' || !hasDocs}
                className="btn-primary">
          {kycStatus === 'APPROVED' ? '✓ Approved' : '✓ Approve KYC'}
        </button>
        <button onClick={() => { setPending('request_more_docs'); setReason(''); setError(null); }}
                disabled={busy || kycStatus === 'APPROVED'}
                className="btn-outline">
          📩 Request more documents
        </button>
        <button onClick={() => { setPending('reject'); setReason(''); setError(null); }}
                disabled={busy || kycStatus === 'APPROVED'}
                className="text-sm text-rose-700 hover:underline">
          Reject KYC
        </button>
      </div>

      {!hasDocs && kycStatus !== 'APPROVED' && (
        <p className="text-xs text-amber-700">
          Customer has no documents on file — they need to upload first before you can approve.
        </p>
      )}

      {pending && (
        <div className="card p-4 space-y-3 border-brand-200 bg-brand-50/30">
          <div>
            <h3 className="font-medium">
              {pending === 'reject' ? 'Reject KYC' : 'Request additional documents'}
            </h3>
            <p className="text-xs text-brand-700 mt-1">
              {pending === 'reject'
                ? 'The customer will receive your reason. They can re-submit after fixing issues.'
                : 'Tell the customer exactly what is missing (e.g. "GST certificate is unreadable; need clearer scan").'}
            </p>
          </div>
          <textarea value={reason} onChange={e => setReason(e.target.value)}
                    rows={3} className="input text-sm w-full"
                    placeholder={pending === 'reject'
                      ? 'Reason for rejection (visible to customer)'
                      : 'What is missing or needs fixing?'} />
          {error && <div className="text-rose-700 text-sm">{error}</div>}
          <div className="flex justify-end gap-3">
            <button onClick={() => { setPending(null); setReason(''); }}
                    disabled={busy} className="btn-outline text-sm">Cancel</button>
            <button onClick={submitWithReason} disabled={busy} className="btn-primary text-sm">
              {busy ? 'Saving…' : pending === 'reject' ? 'Reject & notify' : 'Send request'}
            </button>
          </div>
        </div>
      )}

      {error && !pending && <div className="text-rose-700 text-sm">{error}</div>}
    </div>
  );
}
