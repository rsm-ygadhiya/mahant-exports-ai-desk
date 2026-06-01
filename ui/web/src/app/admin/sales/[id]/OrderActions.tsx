'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function OrderActions({ orderId, status }: { orderId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (reason.trim().length < 3) { setError('Reason is required to cancel.'); return; }
    setBusy(true); setError(null);
    const res = await fetch(`/api/admin/orders/${orderId}/cancel`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(body.error ?? 'Failed.'); return; }
    setConfirming(false); setReason('');
    router.refresh();
  }

  return (
    <div className="space-y-2 border-t border-brand-100 pt-3">
      {!confirming ? (
        <button onClick={() => { setConfirming(true); setError(null); }}
                disabled={busy}
                className="text-xs text-rose-700 hover:underline">
          Cancel this order
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-sm">
            <b className="text-rose-700">Cancel order?</b> Stones currently SOLD will revert to AVAILABLE.
            Confirmed payments remain on record but the order is marked CANCELLED.
          </p>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
                    placeholder="Reason for cancellation (audit)" className="input text-sm" />
          {error && <div className="text-rose-700 text-sm">{error}</div>}
          <div className="flex gap-2">
            <button onClick={cancel} disabled={busy} className="text-sm btn-outline">
              {busy ? 'Cancelling…' : 'Confirm cancel'}
            </button>
            <button onClick={() => { setConfirming(false); setReason(''); }}
                    className="text-sm text-brand-700">
              Keep order
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
