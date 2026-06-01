'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function NewCustomerForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [form, setForm] = useState({
    mobile: '',
    email: '',
    password: '',
    companyName: '',
    contactPerson: '',
    country: '',
    city: '',
    status: 'APPROVED' as 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED',
    pricingMode: 'BASE' as 'BASE' | 'ADJUST_PCT' | 'HIDDEN',
    adjustPct: '',
    notes: '',
  });

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm({ ...form, [k]: v });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setDone(null);
    const res = await fetch('/api/admin/customers', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...form, adjustPct: form.adjustPct === '' ? null : Number(form.adjustPct) }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Failed to create customer.');
      return;
    }
    const data = await res.json();
    setDone(`Customer ${data.companyName} created.`);
    setTimeout(() => router.push('/admin/customers'), 600);
  }

  return (
    <form onSubmit={submit} className="card p-6 space-y-4">
      <Section title="Company & contact">
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Company name *">
            <input className="input" required value={form.companyName}
                   onChange={e => set('companyName', e.target.value)} />
          </Field>
          <Field label="Contact person *">
            <input className="input" required value={form.contactPerson}
                   onChange={e => set('contactPerson', e.target.value)} />
          </Field>
          <Field label="Mobile (with country code) *">
            <input className="input" required minLength={8} placeholder="919999999991"
                   value={form.mobile}
                   onChange={e => set('mobile', e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Email">
            <input className="input" type="email" value={form.email}
                   onChange={e => set('email', e.target.value)} />
          </Field>
          <Field label="Country">
            <input className="input" value={form.country}
                   onChange={e => set('country', e.target.value)} />
          </Field>
          <Field label="City">
            <input className="input" value={form.city}
                   onChange={e => set('city', e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="Access">
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Login password (min 6 chars)">
            <input className="input" type="text" minLength={6}
                   placeholder="Set the buyer's login password"
                   value={form.password}
                   onChange={e => set('password', e.target.value)} />
          </Field>
          <Field label="Account status">
            <select className="input" value={form.status}
                    onChange={e => set('status', e.target.value as any)}>
              <option value="APPROVED">Approved (sees prices)</option>
              <option value="PENDING">Pending (no prices)</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Pricing tier">
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="Mode">
            <select className="input" value={form.pricingMode}
                    onChange={e => set('pricingMode', e.target.value as any)}>
              <option value="BASE">Base — show real price</option>
              <option value="ADJUST_PCT">Adjust % — discount/markup</option>
              <option value="HIDDEN">Hidden — must enquire</option>
            </select>
          </Field>
          {form.pricingMode === 'ADJUST_PCT' && (
            <Field label="Adjust % (negative = discount)">
              <input className="input" type="number" step="0.01" placeholder="-2.5"
                     value={form.adjustPct}
                     onChange={e => set('adjustPct', e.target.value)} />
            </Field>
          )}
          <Field label="Internal notes">
            <input className="input" value={form.notes}
                   onChange={e => set('notes', e.target.value)} />
          </Field>
        </div>
      </Section>

      {error && <div className="text-rose-700 text-sm bg-rose-50 p-2 rounded">{error}</div>}
      {done && <div className="text-emerald-700 text-sm bg-emerald-50 p-2 rounded">{done}</div>}

      <div className="flex gap-3">
        <button className="btn-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create customer'}
        </button>
        <button type="button" onClick={() => router.push('/admin/customers')} className="btn-outline">
          Cancel
        </button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-brand-700 mb-2">{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm text-brand-700">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
