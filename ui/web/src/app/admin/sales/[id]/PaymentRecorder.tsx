'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtUsd } from '@/lib/format';

type Method = 'BANK_TRANSFER' | 'CASH' | 'CHEQUE' | 'UPI' | 'OTHER';

const METHOD_LABEL: Record<Method, string> = {
  BANK_TRANSFER: 'Bank transfer',
  CASH:          'Cash',
  CHEQUE:        'Cheque',
  UPI:           'UPI',
  OTHER:         'Other',
};

export function PaymentRecorder({ orderId, outstanding }: { orderId: string; outstanding: number }) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(outstanding));
  const [method, setMethod] = useState<Method>('BANK_TRANSFER');
  const [transactionRef, setTransactionRef] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /// When a cash payment is recorded, the server returns a one-time token.
  /// We show it ONCE in a prominent box and never re-fetch it.
  const [cashToken, setCashToken] = useState<string | null>(null);

  async function submit() {
    setError(null); setCashToken(null);
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) { setError('Enter a positive amount.'); return; }

    setBusy(true);
    const res = await fetch(`/api/admin/orders/${orderId}/payments`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        amount: n,
        method,
        transactionRef: transactionRef || undefined,
        notes: notes || undefined,
      }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) { setError(body.error ?? 'Failed.'); return; }

    if (body.status === 'PENDING_CASH_APPROVAL' && body.approvalToken) {
      setCashToken(body.approvalToken);
      // Don't refresh yet — show the token first.
    } else {
      // Bank / UPI / etc. — instant confirm, refresh page state.
      setAmount(''); setTransactionRef(''); setNotes('');
      router.refresh();
    }
  }

  function dismissToken() {
    setCashToken(null);
    setAmount(''); setTransactionRef(''); setNotes('');
    router.refresh();
  }

  return (
    <div className="card p-4 bg-brand-50/30 border-brand-200 space-y-3">
      <h3 className="font-medium text-sm">Record payment · outstanding {fmtUsd(outstanding)}</h3>

      {!cashToken ? (
        <>
          <div className="grid md:grid-cols-4 gap-3 text-sm">
            <label className="block">
              <span className="text-xs uppercase tracking-widest text-brand-700">Amount</span>
              <input type="number" step="0.01" min="0.01" value={amount}
                     onChange={e => setAmount(e.target.value)} className="input mt-1" />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-widest text-brand-700">Method</span>
              <select className="input mt-1" value={method} onChange={e => setMethod(e.target.value as Method)}>
                {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-widest text-brand-700">Reference</span>
              <input value={transactionRef} onChange={e => setTransactionRef(e.target.value)}
                     placeholder={method === 'CHEQUE' ? 'Cheque #' : method === 'CASH' ? 'Receipt #' : 'Txn ID'}
                     className="input mt-1" />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-widest text-brand-700">Notes</span>
              <input value={notes} onChange={e => setNotes(e.target.value)} className="input mt-1" />
            </label>
          </div>

          {method === 'CASH' && (
            <div className="text-xs text-amber-800 bg-amber-50/60 p-2 rounded">
              <b>Cash payment:</b> on submit you'll get a one-time 6-digit <i>approval code</i>.
              Share it with the Accounts team — they enter it to confirm. The payment is
              <b> not counted</b> against the order balance until approved.
            </div>
          )}

          {error && <div className="text-rose-700 text-sm">{error}</div>}

          <div className="flex justify-end">
            <button onClick={submit} disabled={busy} className="btn-primary">
              {busy ? 'Recording…' : 'Record payment'}
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <div className="text-sm text-emerald-800">Cash payment recorded — pending Accounts approval.</div>
          <div className="card p-6 bg-white border-2 border-gold-500 text-center">
            <div className="text-xs uppercase tracking-widest text-brand-700 mb-1">Approval code</div>
            <div className="font-mono text-5xl tracking-[0.3em] text-gold-700">{cashToken}</div>
            <div className="text-xs text-brand-700 mt-2">
              Share this with the Accounts team. <b>This is shown only once.</b>
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={dismissToken} className="btn-primary">I've saved it</button>
          </div>
        </div>
      )}
    </div>
  );
}
