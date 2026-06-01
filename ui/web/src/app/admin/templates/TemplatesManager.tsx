'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Template = {
  id: string; key: string; name: string;
  description: string | null;
  subject: string; body: string;
  channel: 'SMS' | 'EMAIL' | 'BOTH';
  isSystem: boolean;
  updatedAt: string;
};

// Mock variables for the live preview. Templates may use any subset of these.
const SAMPLE_VARS: Record<string, string> = {
  contactPerson: 'Ravi Patel',
  companyName: 'Demo Diamonds Pvt Ltd',
  uniqueCode: 'CUST-2026-00001',
  reason: '(your reason text)',
  stonesList: '• LGSTK00001 — Round 1.00ct F/VS1\n• LGSTK00002 — Pear 1.50ct G/VS2',
  memoLocation: 'Mahant Exports, Surat office',
  memoPickupAt: 'Friday 12 Jun 2026, 11:00 AM',
  orderCode: 'ORD-2026-00001',
  totalAmount: '$2,450.00',
  outstanding: '$1,225.00',
  dueDate: '15 Jun 2026',
  daysUntilDue: '3',
  daysOverdue: '7',
};

function preview(body: string): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, k) => SAMPLE_VARS[k] ?? `[${k}]`);
}

export function TemplatesManager({ templates }: { templates: Template[] }) {
  return (
    <div className="space-y-3">
      {templates.map(t => <TemplateRow key={t.id} template={t} />)}
    </div>
  );
}

function TemplateRow({ template }: { template: Template }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [channel, setChannel] = useState<Template['channel']>(template.channel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const isDirty = subject !== template.subject || body !== template.body || channel !== template.channel;

  async function save() {
    setBusy(true); setError(null);
    const res = await fetch(`/api/admin/templates/${template.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject, body, channel }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error ?? `Failed (${res.status})`); return; }
    setSavedAt(new Date().toLocaleTimeString());
    router.refresh();
  }

  function reset() {
    setSubject(template.subject);
    setBody(template.body);
    setChannel(template.channel);
    setError(null);
  }

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 py-3 bg-brand-50 hover:bg-brand-100 transition text-left">
        <div className="flex-1">
          <div className="font-medium">{template.name}</div>
          <div className="text-xs font-mono text-brand-700">{template.key}</div>
          {template.description && (
            <div className="text-xs text-brand-700/70 mt-1">{template.description}</div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs px-2 py-0.5 rounded bg-white border border-brand-100">{template.channel}</span>
          {template.isSystem && <span className="text-xs px-2 py-0.5 rounded bg-gold-500/20 text-gold-700">System</span>}
          <span className="text-brand-700 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="p-4 space-y-3 text-sm">
          <div className="grid md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs uppercase tracking-widest text-brand-700">Subject (email channel)</span>
              <input className="input mt-1" value={subject} onChange={e => setSubject(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-widest text-brand-700">Channel</span>
              <select className="input mt-1" value={channel} onChange={e => setChannel(e.target.value as any)}>
                <option value="BOTH">Both — SMS + Email</option>
                <option value="SMS">SMS only</option>
                <option value="EMAIL">Email only</option>
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-xs uppercase tracking-widest text-brand-700">
              Body
              <span className="ml-2 text-brand-700/60 normal-case tracking-normal">
                — use {'{{contactPerson}}'}, {'{{stonesList}}'}, {'{{orderCode}}'}, etc.
              </span>
            </span>
            <textarea rows={10} value={body} onChange={e => setBody(e.target.value)}
                      className="input mt-1 font-mono text-xs" />
          </label>

          <details>
            <summary className="cursor-pointer text-xs text-brand-700">Live preview (with sample data)</summary>
            <div className="mt-2 bg-brand-50 rounded p-3">
              {subject && <div className="text-xs text-brand-700 mb-2">Subject: <b>{preview(subject)}</b></div>}
              <pre className="whitespace-pre-wrap font-mono text-xs">{preview(body)}</pre>
            </div>
          </details>

          {error && <div className="text-rose-700 text-sm bg-rose-50 p-2 rounded">{error}</div>}

          <div className="flex items-center justify-between border-t border-brand-100 pt-2">
            <div className="text-xs text-brand-700">
              Last edited: {new Date(template.updatedAt).toLocaleString()}
              {savedAt && <span className="ml-2 text-emerald-700">✓ Saved at {savedAt}</span>}
            </div>
            <div className="flex gap-3">
              <button onClick={reset} disabled={busy || !isDirty} className="btn-outline text-sm">Reset</button>
              <button onClick={save} disabled={busy || !isDirty} className="btn-primary text-sm">
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
