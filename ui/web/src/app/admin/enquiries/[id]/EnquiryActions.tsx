'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Tpl = { subject: string; body: string };

function renderPreview(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, k) => vars[k] ?? `[${k}]`);
}

export function EnquiryActions({
  enquiryId, customerName, stonesList, totalAmount,
  memoTemplate, saleTemplate, cancelTemplate,
}: {
  enquiryId: string; customerName: string; stonesList: string; totalAmount: string;
  memoTemplate: Tpl; saleTemplate: Tpl; cancelTemplate: Tpl;
}) {
  const [active, setActive] = useState<'memo' | 'sale' | 'cancel' | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <button onClick={() => setActive('memo')}    className="btn-primary">→ Memo</button>
        <button onClick={() => setActive('sale')}    className="btn-gold">→ Confirm Sale</button>
        <button onClick={() => setActive('cancel')}  className="btn-outline text-rose-700">Cancel enquiry</button>
      </div>

      {active === 'memo' && (
        <MemoPanel
          enquiryId={enquiryId} customerName={customerName} stonesList={stonesList}
          template={memoTemplate} onClose={() => setActive(null)}
        />
      )}
      {active === 'sale' && (
        <SalePanel
          enquiryId={enquiryId} customerName={customerName} stonesList={stonesList} totalAmount={totalAmount}
          template={saleTemplate} onClose={() => setActive(null)}
        />
      )}
      {active === 'cancel' && (
        <CancelPanel
          enquiryId={enquiryId} customerName={customerName} stonesList={stonesList}
          template={cancelTemplate} onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}

function MemoPanel({
  enquiryId, customerName, stonesList, template, onClose,
}: {
  enquiryId: string; customerName: string; stonesList: string;
  template: Tpl; onClose: () => void;
}) {
  const router = useRouter();
  const defaultTime = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 16); // tomorrow same time
  const [location, setLocation] = useState('Mahant Exports, Surat office');
  const [pickupAt, setPickupAt] = useState(defaultTime);
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vars = {
    contactPerson: customerName, stonesList,
    memoLocation: location,
    memoPickupAt: pickupAt ? new Date(pickupAt).toLocaleString() : '',
  };

  async function send() {
    setBusy(true); setError(null);
    const res = await fetch(`/api/admin/enquiries/${enquiryId}/approve-memo`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        memoLocation: location, memoPickupAt: new Date(pickupAt).toISOString(),
        ...(editing ? { customSubject: subject, customBody: body } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data.error ?? `Failed (${res.status})`); return; }
    router.refresh();
  }

  return (
    <div className="card p-5 space-y-4 bg-emerald-50/30 border-emerald-200">
      <h3 className="font-serif text-lg">→ Approve for Memo</h3>
      <div className="grid md:grid-cols-2 gap-3 text-sm">
        <label className="block">
          <span className="text-xs uppercase tracking-widest text-brand-700">Pickup location *</span>
          <input className="input mt-1" value={location} onChange={e => setLocation(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-widest text-brand-700">Pickup date / time *</span>
          <input type="datetime-local" className="input mt-1" value={pickupAt} onChange={e => setPickupAt(e.target.value)} />
        </label>
      </div>

      <MessagePreview
        subject={editing ? subject : template.subject}
        body={editing ? body : template.body}
        vars={vars}
        editing={editing}
        onEdit={() => setEditing(true)}
        onChangeSubject={setSubject}
        onChangeBody={setBody}
      />

      {error && <div className="text-rose-700 text-sm bg-rose-50 p-2 rounded">{error}</div>}
      <div className="flex justify-end gap-3">
        <button onClick={onClose} className="btn-outline">Cancel</button>
        <button onClick={send} disabled={busy || !location || !pickupAt} className="btn-primary">
          {busy ? 'Approving…' : '✓ Approve & send'}
        </button>
      </div>
    </div>
  );
}

function SalePanel({
  enquiryId, customerName, stonesList, totalAmount, template, onClose,
}: {
  enquiryId: string; customerName: string; stonesList: string; totalAmount: string;
  template: Tpl; onClose: () => void;
}) {
  const router = useRouter();
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  const [sendBankDetails, setSendBankDetails] = useState(true);
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vars = {
    contactPerson: customerName, stonesList, totalAmount,
    orderCode: '(generated on confirm)',
    dueDate: dueDate ? new Date(dueDate).toLocaleDateString() : 'On invoice',
  };

  async function send() {
    setBusy(true); setError(null);
    const res = await fetch(`/api/admin/enquiries/${enquiryId}/approve-sale`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        sendBankDetails,
        ...(editing ? { customSubject: subject, customBody: body } : {}),
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error ?? `Failed (${res.status})`); return; }
    // Jump straight to the freshly-created order.
    if (data.orderId) {
      router.push(`/admin/sales/${data.orderId}`);
    } else {
      router.refresh();
    }
  }

  return (
    <div className="card p-5 space-y-4 bg-gold-500/5 border-gold-300">
      <h3 className="font-serif text-lg">→ Confirm as Sale</h3>
      <p className="text-xs text-brand-700">
        This creates a CONFIRMED order in <b>/admin/sales</b>, flips the stones to SOLD,
        and sends the sale confirmation to the customer.
      </p>
      <div className="grid md:grid-cols-2 gap-3 text-sm">
        <label className="block">
          <span className="text-xs uppercase tracking-widest text-brand-700">Payment due date</span>
          <input type="date" className="input mt-1" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </label>
        <label className="block self-end">
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={sendBankDetails} onChange={e => setSendBankDetails(e.target.checked)} />
            <span className="text-sm">Also send the bank details message</span>
          </div>
          <p className="text-xs text-brand-700/70 mt-1">(Edit your bank info under <b>Templates → bank.details</b>)</p>
        </label>
      </div>

      <MessagePreview
        subject={editing ? subject : template.subject}
        body={editing ? body : template.body}
        vars={vars}
        editing={editing}
        onEdit={() => setEditing(true)}
        onChangeSubject={setSubject}
        onChangeBody={setBody}
      />

      {error && <div className="text-rose-700 text-sm bg-rose-50 p-2 rounded">{error}</div>}
      <div className="flex justify-end gap-3">
        <button onClick={onClose} className="btn-outline">Back</button>
        <button onClick={send} disabled={busy} className="btn-gold">
          {busy ? 'Creating order…' : '✓ Confirm sale + send'}
        </button>
      </div>
    </div>
  );
}

function CancelPanel({
  enquiryId, customerName, stonesList, template, onClose,
}: {
  enquiryId: string; customerName: string; stonesList: string;
  template: Tpl; onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vars = { contactPerson: customerName, stonesList, reason };

  async function send() {
    if (reason.trim().length < 3) { setError('Please give a reason.'); return; }
    setBusy(true); setError(null);
    const res = await fetch(`/api/admin/enquiries/${enquiryId}/cancel`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: reason.trim(),
        ...(editing ? { customSubject: subject, customBody: body } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data.error ?? `Failed (${res.status})`); return; }
    router.refresh();
  }

  return (
    <div className="card p-5 space-y-4 bg-rose-50/30 border-rose-200">
      <h3 className="font-serif text-lg">Cancel enquiry</h3>
      <label className="block">
        <span className="text-xs uppercase tracking-widest text-brand-700">Reason (sent to customer) *</span>
        <textarea rows={2} value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="e.g. The stones you enquired about have just been sold to another buyer."
                  className="input text-sm mt-1" />
      </label>

      <MessagePreview
        subject={editing ? subject : template.subject}
        body={editing ? body : template.body}
        vars={vars}
        editing={editing}
        onEdit={() => setEditing(true)}
        onChangeSubject={setSubject}
        onChangeBody={setBody}
      />

      {error && <div className="text-rose-700 text-sm bg-rose-50 p-2 rounded">{error}</div>}
      <div className="flex justify-end gap-3">
        <button onClick={onClose} className="btn-outline">Back</button>
        <button onClick={send} disabled={busy} className="btn-primary">
          {busy ? 'Cancelling…' : 'Cancel & notify customer'}
        </button>
      </div>
    </div>
  );
}

function MessagePreview({
  subject, body, vars, editing, onEdit, onChangeSubject, onChangeBody,
}: {
  subject: string; body: string; vars: Record<string, string>;
  editing: boolean;
  onEdit: () => void;
  onChangeSubject: (s: string) => void;
  onChangeBody: (s: string) => void;
}) {
  return (
    <div className="bg-brand-50 rounded p-3 space-y-2 text-sm">
      <div className="flex justify-between items-center">
        <span className="text-xs uppercase tracking-widest text-brand-700">Message preview</span>
        {!editing ? (
          <button onClick={onEdit} className="text-xs text-gold-600 hover:underline">✎ Edit before sending</button>
        ) : (
          <span className="text-xs text-amber-700">Custom message — variables still substituted</span>
        )}
      </div>
      {editing ? (
        <>
          <input value={subject} onChange={e => onChangeSubject(e.target.value)}
                 placeholder="Subject (email only)" className="input text-sm w-full" />
          <textarea value={body} onChange={e => onChangeBody(e.target.value)}
                    rows={8} className="input text-sm w-full font-mono" />
          <details className="text-xs text-brand-700">
            <summary className="cursor-pointer">Preview as customer will receive</summary>
            <pre className="whitespace-pre-wrap font-mono p-2 mt-1 bg-white border border-brand-100 rounded">{renderPreview(body, vars)}</pre>
          </details>
        </>
      ) : (
        <pre className="whitespace-pre-wrap font-mono text-xs p-2 bg-white border border-brand-100 rounded">
{renderPreview(body, vars)}
        </pre>
      )}
    </div>
  );
}
