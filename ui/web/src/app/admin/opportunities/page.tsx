'use client';
import { useEffect, useState } from 'react';
import { ALL_REGIONS, type Region } from '@/lib/opportunities/seed';
import type { EnrichedOpportunity, EmailDraft, PortalForm } from '@/lib/opportunities/store';

export default function OpportunitiesPage() {
  const [regions, setRegions] = useState<Region[]>(ALL_REGIONS);
  const [opps, setOpps] = useState<EnrichedOpportunity[]>([]);
  const [loading, setLoading] = useState(false);
  const [pursuing, setPursuing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<EnrichedOpportunity | null>(null);

  // Load any previously-persisted opportunities on mount.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/admin/opportunities/list');
        const data = await r.json();
        if (Array.isArray(data.opportunities)) setOpps(data.opportunities);
      } catch { /* ignore */ }
    })();
  }, []);

  function toggleRegion(r: Region) {
    setRegions(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);
  }

  async function find() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/opportunities/find', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ regions }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? 'find failed');
      setOpps(data.opportunities ?? []);
    } catch (e: any) {
      setError(e?.message ?? 'find failed');
    } finally {
      setLoading(false);
    }
  }

  async function pursue(opp: EnrichedOpportunity) {
    setPursuing(opp.id);
    setError(null);
    try {
      const r = await fetch('/api/admin/opportunities/pursue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: opp.id }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? 'pursue failed');
      const updated: EnrichedOpportunity = data.opportunity;
      setOpps(prev => prev.map(o => o.id === updated.id ? updated : o));
      setSelected(updated);
    } catch (e: any) {
      setError(e?.message ?? 'pursue failed');
    } finally {
      setPursuing(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">🌐 Opportunity Finder</h1>
        <p className="text-sm text-brand-700 mt-1 max-w-2xl">
          Surface B2B buyers (retailers, marketplaces, bridal chains) that fit Mahant&apos;s
          inventory. Click <b>Find opportunities</b>, then <b>Pursue</b> on any lead to
          auto-fill the portal form and draft an outreach email for review.
        </p>
      </div>

      {/* Region picker */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="text-sm text-brand-900">
            <b>Regions:</b>
            <span className="ml-2 text-brand-700">{regions.length} selected</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setRegions(ALL_REGIONS)}
              className="text-xs px-2.5 py-1 rounded border border-brand-200 hover:bg-brand-50"
            >
              Select all
            </button>
            <button
              onClick={() => setRegions([])}
              className="text-xs px-2.5 py-1 rounded border border-brand-200 hover:bg-brand-50"
            >
              Clear
            </button>
            <button
              onClick={find}
              disabled={loading || regions.length === 0}
              className="px-4 py-1.5 rounded bg-brand-900 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              {loading ? 'Searching…' : '▶ Find opportunities'}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {ALL_REGIONS.map(r => (
            <label key={r} className={`text-xs px-3 py-1.5 rounded-full border cursor-pointer transition
              ${regions.includes(r)
                ? 'bg-brand-900 text-white border-brand-900'
                : 'bg-white text-brand-700 border-brand-200 hover:bg-brand-50'}`}>
              <input
                type="checkbox"
                checked={regions.includes(r)}
                onChange={() => toggleRegion(r)}
                className="sr-only"
              />
              {r}
            </label>
          ))}
        </div>
      </div>

      {error && (
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* Results grid */}
      {opps.length > 0 && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {opps.map(o => (
            <OpportunityCard
              key={o.id}
              opp={o}
              isPursuing={pursuing === o.id}
              onPursue={() => pursue(o)}
              onOpen={() => setSelected(o)}
            />
          ))}
        </div>
      )}

      {/* Detail drawer */}
      {selected && (
        <DetailModal
          opp={selected}
          onClose={() => setSelected(null)}
          onUpdate={(o) => {
            setOpps(prev => prev.map(p => p.id === o.id ? o : p));
            setSelected(o);
          }}
        />
      )}
    </div>
  );
}

function OpportunityCard({
  opp, isPursuing, onPursue, onOpen,
}: {
  opp: EnrichedOpportunity;
  isPursuing: boolean;
  onPursue: () => void;
  onOpen: () => void;
}) {
  const confColor = opp.confidence >= 75 ? 'text-emerald-700'
                  : opp.confidence >= 55 ? 'text-amber-700' : 'text-brand-700';
  const statusBadge = opp.status === 'sent'
    ? <span className="text-[10px] uppercase tracking-wider bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">Sent</span>
    : opp.status === 'pursuing'
    ? <span className="text-[10px] uppercase tracking-wider bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">Drafted</span>
    : opp.status === 'discarded'
    ? <span className="text-[10px] uppercase tracking-wider bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded">Discarded</span>
    : null;

  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-serif text-lg leading-tight truncate">{opp.company}</div>
          <div className="text-xs text-brand-700 mt-0.5">
            {opp.region} · {opp.segment}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-xs font-mono ${confColor}`}>{opp.confidence}% fit</div>
          {statusBadge && <div className="mt-1">{statusBadge}</div>}
        </div>
      </div>
      <p className="text-xs text-brand-700/90 line-clamp-3">{opp.fit_summary}</p>
      <div className="text-[11px] text-brand-700/70">
        Contact: <span className="italic">{opp.contact_role}</span>
      </div>
      <div className="flex gap-2 mt-1">
        {opp.status === 'new' ? (
          <button
            onClick={onPursue}
            disabled={isPursuing}
            className="flex-1 px-3 py-1.5 rounded bg-brand-900 text-white text-xs font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {isPursuing ? 'Drafting…' : 'Pursue →'}
          </button>
        ) : (
          <button
            onClick={onOpen}
            className="flex-1 px-3 py-1.5 rounded bg-brand-50 border border-brand-200 text-brand-900 text-xs font-medium hover:bg-brand-100"
          >
            Open review →
          </button>
        )}
      </div>
    </div>
  );
}

function DetailModal({
  opp, onClose, onUpdate,
}: {
  opp: EnrichedOpportunity;
  onClose: () => void;
  onUpdate: (o: EnrichedOpportunity) => void;
}) {
  const [email, setEmail] = useState<EmailDraft>(opp.email_draft ?? { to: '', to_role: '', subject: '', body: '' });
  const [form, setForm] = useState<PortalForm | null>(opp.portal_form ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<null | 'send' | 'discard'>(null);

  useEffect(() => {
    setEmail(opp.email_draft ?? { to: '', to_role: '', subject: '', body: '' });
    setForm(opp.portal_form ?? null);
  }, [opp.id, opp.email_draft, opp.portal_form]);

  async function save() {
    setSaving(true); setError(null);
    try {
      const r = await fetch('/api/admin/opportunities/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: opp.id, email_draft: email, portal_form: form }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? 'save failed');
      onUpdate(data.opportunity);
    } catch (e: any) {
      setError(e?.message ?? 'save failed');
    } finally {
      setSaving(false);
    }
  }

  async function decide(action: 'send' | 'discard') {
    setSaving(true); setError(null);
    try {
      // Save edits first so the recorded send/discard reflects the final text.
      if (action === 'send') {
        await fetch('/api/admin/opportunities/save', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: opp.id, email_draft: email, portal_form: form }),
        });
      }
      const r = await fetch('/api/admin/opportunities/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: opp.id, action }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? 'decide failed');
      onUpdate(data.opportunity);
      setConfirmed(action);
    } catch (e: any) {
      setError(e?.message ?? 'decide failed');
    } finally {
      setSaving(false);
    }
  }

  const isFinal = opp.status === 'sent' || opp.status === 'discarded';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4 md:p-8"
         onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl my-8" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-brand-100 flex items-start justify-between gap-3">
          <div>
            <div className="font-serif text-2xl">{opp.company}</div>
            <div className="text-xs text-brand-700 mt-0.5">
              {opp.region} · {opp.segment} · {opp.confidence}% fit
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded hover:bg-brand-50 text-brand-700 hover:text-brand-900">✕</button>
        </div>

        <div className="px-5 py-4 space-y-5">
          <div className="text-sm text-brand-900 bg-brand-50/60 border border-brand-100 rounded p-3">
            <b>Why this fit:</b> {opp.fit_summary}
            {opp.portal_url && (
              <div className="mt-1 text-xs">
                <span className="text-brand-700">Public portal:</span>{' '}
                <a href={opp.portal_url} target="_blank" rel="noreferrer" className="text-brand-900 underline hover:text-gold-600">
                  {opp.portal_url}
                </a>
              </div>
            )}
          </div>

          {/* Portal form */}
          {form && (
            <div>
              <h2 className="font-serif text-lg mb-2">Supplier portal — auto-filled</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {([
                  ['company_name', 'Company name'],
                  ['founded', 'Founded'],
                  ['hq', 'HQ'],
                  ['certifications', 'Certifications'],
                  ['contact_name', 'Contact name'],
                  ['contact_email', 'Contact email'],
                  ['contact_phone', 'Contact phone'],
                ] as Array<[keyof PortalForm, string]>).map(([k, label]) => (
                  <label key={k} className="text-xs text-brand-700 flex flex-col gap-1">
                    {label}
                    <input
                      value={form[k]}
                      disabled={isFinal}
                      onChange={e => setForm({ ...form, [k]: e.target.value })}
                      className="border border-brand-200 rounded px-2 py-1.5 text-sm bg-white disabled:bg-brand-50/50"
                    />
                  </label>
                ))}
                <label className="text-xs text-brand-700 flex flex-col gap-1 sm:col-span-2">
                  Inventory summary
                  <textarea
                    rows={2}
                    value={form.inventory_summary}
                    disabled={isFinal}
                    onChange={e => setForm({ ...form, inventory_summary: e.target.value })}
                    className="border border-brand-200 rounded px-2 py-1.5 text-sm bg-white disabled:bg-brand-50/50"
                  />
                </label>
                <label className="text-xs text-brand-700 flex flex-col gap-1 sm:col-span-2">
                  Unique value
                  <textarea
                    rows={2}
                    value={form.unique_value}
                    disabled={isFinal}
                    onChange={e => setForm({ ...form, unique_value: e.target.value })}
                    className="border border-brand-200 rounded px-2 py-1.5 text-sm bg-white disabled:bg-brand-50/50"
                  />
                </label>
              </div>
            </div>
          )}

          {/* Email draft */}
          <div>
            <h2 className="font-serif text-lg mb-2">Outreach email — review before sending</h2>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-brand-700 flex flex-col gap-1">
                  To
                  <input
                    value={email.to}
                    disabled={isFinal}
                    onChange={e => setEmail({ ...email, to: e.target.value })}
                    className="border border-brand-200 rounded px-2 py-1.5 text-sm bg-white disabled:bg-brand-50/50"
                  />
                </label>
                <label className="text-xs text-brand-700 flex flex-col gap-1">
                  Recipient role
                  <input
                    value={email.to_role}
                    disabled={isFinal}
                    onChange={e => setEmail({ ...email, to_role: e.target.value })}
                    className="border border-brand-200 rounded px-2 py-1.5 text-sm bg-white disabled:bg-brand-50/50"
                  />
                </label>
              </div>
              <label className="text-xs text-brand-700 flex flex-col gap-1">
                Subject
                <input
                  value={email.subject}
                  disabled={isFinal}
                  onChange={e => setEmail({ ...email, subject: e.target.value })}
                  className="border border-brand-200 rounded px-2 py-1.5 text-sm bg-white disabled:bg-brand-50/50"
                />
              </label>
              <label className="text-xs text-brand-700 flex flex-col gap-1">
                Body
                <textarea
                  rows={9}
                  value={email.body}
                  disabled={isFinal}
                  onChange={e => setEmail({ ...email, body: e.target.value })}
                  className="border border-brand-200 rounded px-2 py-1.5 text-sm bg-white font-mono disabled:bg-brand-50/50"
                />
              </label>
            </div>
          </div>

          {error && (
            <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
              {error}
            </div>
          )}

          {confirmed && (
            <div className={`text-sm rounded px-3 py-2 border
                ${confirmed === 'send'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-brand-50 border-brand-200 text-brand-900'}`}>
              {confirmed === 'send'
                ? '✓ Email queued as sent. (Demo mode — no SMTP wired.)'
                : '✗ Opportunity discarded.'}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-brand-100 bg-brand-50/40 flex flex-wrap items-center justify-end gap-2">
          {!isFinal && (
            <>
              <button
                onClick={save}
                disabled={saving}
                className="px-3 py-1.5 rounded border border-brand-200 bg-white text-sm hover:bg-brand-50 disabled:opacity-50"
              >
                Save draft
              </button>
              <button
                onClick={() => decide('discard')}
                disabled={saving}
                className="px-3 py-1.5 rounded border border-rose-200 bg-white text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                Discard
              </button>
              <button
                onClick={() => decide('send')}
                disabled={saving}
                className="px-4 py-1.5 rounded bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-50"
              >
                ✉ Send email
              </button>
            </>
          )}
          {isFinal && (
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded bg-brand-900 text-white text-sm hover:bg-brand-700"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
