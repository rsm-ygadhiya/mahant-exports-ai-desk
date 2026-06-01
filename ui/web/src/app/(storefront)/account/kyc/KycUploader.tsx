'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Doc = {
  id: string; kind: string; label: string;
  filename: string; mimeType: string; sizeBytes: number;
  uploadedAt: string;
};

const KINDS: Array<{ value: string; label: string; required?: boolean; hint?: string }> = [
  { value: 'GST',           label: 'GST Certificate',           required: true, hint: 'PDF or photo of your GST registration certificate' },
  { value: 'PAN',           label: 'PAN Card',                  required: true, hint: 'PAN card of company or proprietor' },
  { value: 'COMPANY_PROOF', label: 'Company Proof',             hint: 'Certificate of Incorporation, MoA, or trade license' },
  { value: 'ADDRESS_PROOF', label: 'Address Proof',             hint: 'Utility bill, lease deed, or rent agreement' },
  { value: 'BANK_DETAILS',  label: 'Bank Details',              hint: 'Cancelled cheque or bank letter' },
  { value: 'OTHER',         label: 'Other',                     hint: 'Anything else our team has asked for' },
];

const KYC_BADGE: Record<string, { cls: string; label: string }> = {
  NOT_SUBMITTED:    { cls: 'badge-gray',  label: 'Not submitted' },
  SUBMITTED:        { cls: 'badge-amber', label: 'Under review' },
  MORE_DOCS_NEEDED: { cls: 'badge-amber', label: 'More docs needed' },
  APPROVED:         { cls: 'badge-green', label: 'Approved' },
  REJECTED:         { cls: 'badge-red',   label: 'Rejected' },
};

function fmtBytes(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

export function KycUploader({
  currentStatus, rejectionReason, initialDocs,
}: { currentStatus: string; rejectionReason: string | null; initialDocs: Doc[] }) {
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[]>(initialDocs);
  const [kind, setKind] = useState<string>('GST');
  const [label, setLabel] = useState<string>('GST Certificate');
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const lockEdits = currentStatus === 'APPROVED';

  function pickKind(value: string) {
    setKind(value);
    const k = KINDS.find(k => k.value === value);
    if (k) setLabel(k.label);
  }

  async function upload() {
    setError(null); setInfo(null);
    const file = fileRef.current?.files?.[0];
    if (!file) { setError('Choose a file first.'); return; }
    if (!label.trim()) { setError('Add a label.'); return; }

    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', kind);
    fd.append('label', label.trim());

    setBusy(true);
    const res = await fetch('/api/customer/kyc/documents', { method: 'POST', body: fd });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) { setError(body.error ?? `Upload failed (${res.status})`); return; }
    setDocs(prev => [{
      id: body.id, kind: body.kind, label: body.label,
      filename: body.filename, mimeType: body.mimeType ?? file.type,
      sizeBytes: body.sizeBytes,
      uploadedAt: body.uploadedAt,
    }, ...prev]);
    setInfo(`Uploaded "${body.label}".`);
    if (fileRef.current) fileRef.current.value = '';
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm('Remove this document?')) return;
    setBusy(true); setError(null);
    const res = await fetch(`/api/customer/kyc/documents/${id}`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? 'Failed to delete.');
      return;
    }
    setDocs(prev => prev.filter(d => d.id !== id));
    router.refresh();
  }

  async function submitForReview() {
    setBusy(true); setError(null); setInfo(null);
    const res = await fetch('/api/customer/kyc/submit', { method: 'POST' });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) { setError(body.error ?? 'Submit failed.'); return; }
    setInfo('Submitted for review. Our team will get back to you.');
    router.refresh();
  }

  const haveGst = docs.some(d => d.kind === 'GST');
  const havePan = docs.some(d => d.kind === 'PAN');
  const readyToSubmit = haveGst && havePan && currentStatus !== 'SUBMITTED' && currentStatus !== 'APPROVED';

  return (
    <div className="space-y-6">
      <div className="card p-4 flex items-center gap-3">
        <span className={KYC_BADGE[currentStatus].cls}>Status: {KYC_BADGE[currentStatus].label}</span>
        {rejectionReason && (
          <span className="text-xs text-rose-700">Last note: <i>{rejectionReason}</i></span>
        )}
      </div>

      {!lockEdits && (
        <div className="card p-6 space-y-4">
          <h2 className="font-serif text-lg">Upload a document</h2>
          <div className="grid md:grid-cols-2 gap-3 text-sm">
            <label className="block">
              <span className="text-xs uppercase tracking-widest text-brand-700">Document type</span>
              <select className="input mt-1" value={kind} onChange={e => pickKind(e.target.value)}>
                {KINDS.map(k => (
                  <option key={k.value} value={k.value}>{k.label}{k.required ? ' *' : ''}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-widest text-brand-700">Label (shown to admin)</span>
              <input className="input mt-1" value={label} onChange={e => setLabel(e.target.value)} />
            </label>
          </div>
          <p className="text-xs text-brand-700/70">
            {KINDS.find(k => k.value === kind)?.hint}
          </p>
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-brand-700">File (PDF or image, max 5 MB)</span>
            <input ref={fileRef} type="file" accept=".pdf,image/*"
                   className="block w-full text-sm mt-1" />
          </label>
          <div className="flex justify-end">
            <button onClick={upload} disabled={busy} className="btn-primary">
              {busy ? 'Uploading…' : 'Upload document'}
            </button>
          </div>
          {error && <div className="text-rose-700 text-sm bg-rose-50 p-2 rounded">{error}</div>}
          {info && <div className="text-emerald-700 text-sm bg-emerald-50 p-2 rounded">{info}</div>}
        </div>
      )}

      <div>
        <h2 className="font-serif text-lg mb-2">Uploaded documents</h2>
        {docs.length === 0 ? (
          <div className="card p-6 text-sm text-brand-700 text-center">No documents uploaded yet.</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-brand-50 text-brand-700 text-left">
                <tr>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Label</th>
                  <th className="px-3 py-2">File</th>
                  <th className="px-3 py-2">Uploaded</th>
                  {!lockEdits && <th className="px-3 py-2 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {docs.map(d => (
                  <tr key={d.id} className="border-t border-brand-100">
                    <td className="px-3 py-2"><span className="badge-gray">{d.kind}</span></td>
                    <td className="px-3 py-2">{d.label}</td>
                    <td className="px-3 py-2 text-xs">
                      <a href={`/api/customer/kyc/documents/${d.id}`} target="_blank"
                         className="text-gold-600 hover:underline">
                        {d.filename}
                      </a>
                      <div className="text-brand-700/60">{fmtBytes(d.sizeBytes)}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">{new Date(d.uploadedAt).toLocaleString()}</td>
                    {!lockEdits && (
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => remove(d.id)} disabled={busy}
                                className="text-xs text-rose-700 hover:underline">Remove</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!lockEdits && (
        <div className="card p-4 flex items-center justify-between flex-wrap gap-3">
          <div className="text-sm">
            <p className="text-brand-700">
              Required: <b className={haveGst ? 'text-emerald-700' : 'text-rose-700'}>GST</b>,{' '}
              <b className={havePan ? 'text-emerald-700' : 'text-rose-700'}>PAN</b>
              {readyToSubmit ? ' — ready to submit.' : '.'}
            </p>
            {currentStatus === 'SUBMITTED' && (
              <p className="text-xs text-brand-700/70">Already submitted — admin will reach out.</p>
            )}
          </div>
          <button onClick={submitForReview} disabled={busy || !readyToSubmit} className="btn-primary">
            {currentStatus === 'SUBMITTED' ? 'Already submitted' : 'Submit for review →'}
          </button>
        </div>
      )}
    </div>
  );
}
