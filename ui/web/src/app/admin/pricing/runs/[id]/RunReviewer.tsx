'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtUsd } from '@/lib/format';

type Proposal = {
  id: string; diamondId: string; stoneId: string;
  shape: string; carat: number; color: string; clarity: string;
  cut: string | null; polish: string | null; symmetry: string | null;
  fluorescence: string | null; lab: string | null;
  oldPpc: number; proposedPpc: number; rapPrice: number | null;
  changePct: number; reasoning: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'APPLIED';
};

type StatusFilter = 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'APPLIED' | 'CHANGED' | 'UNCHANGED';

type GemFilters = {
  shape: string[]; color: string[]; clarity: string[]; lab: string[];
  caratMin: string; caratMax: string;
  ppcMin: string;   ppcMax: string;
  discMin: string;  discMax: string;     // disc-off-Rap % range
  stoneIdQuery: string;
};

type SortKey = 'stoneId' | 'shape' | 'carat' | 'color' | 'clarity' | 'rapPrice'
             | 'discOffRap' | 'oldPpc' | 'proposedPpc' | 'changePct' | 'status';
type SortDir = 'asc' | 'desc';

// Disc-off-Rap histogram buckets used by the click-to-filter strip above the table.
const DISC_BUCKETS = [
  { label: '<70%', min: 0,   max: 70 },
  { label: '70-80', min: 70, max: 80 },
  { label: '80-85', min: 80, max: 85 },
  { label: '85-90', min: 85, max: 90 },
  { label: '90-93', min: 90, max: 93 },
  { label: '93-96', min: 93, max: 96 },
  { label: '96-98', min: 96, max: 98 },
  { label: '98%+',  min: 98, max: 100 },
] as const;

function discOffRapFor(p: Proposal): number | null {
  return p.rapPrice && p.rapPrice > 0 ? (1 - p.proposedPpc / p.rapPrice) * 100 : null;
}

const OPTIONS = {
  shape:   ['Round', 'Princess', 'Oval', 'Emerald', 'Radiant', 'Pear', 'Heart', 'Cushion', 'Marquise', 'Asscher'],
  color:   ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'],
  clarity: ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'SI3', 'I1'],
  lab:     ['IGI', 'GIA', 'GCAL', 'HRD', 'SGL'],
};

const EMPTY_FILTERS: GemFilters = {
  shape: [], color: [], clarity: [], lab: [],
  caratMin: '', caratMax: '', ppcMin: '', ppcMax: '', discMin: '', discMax: '',
  stoneIdQuery: '',
};

const STATUS_CLS: Record<Proposal['status'], string> = {
  PENDING:  'bg-amber-50 text-amber-800',
  APPROVED: 'bg-emerald-50 text-emerald-800',
  REJECTED: 'bg-brand-50 text-brand-700',
  APPLIED:  'bg-gold-500/10 text-gold-700',
};

export function RunReviewer({
  runId, initialProposals, runStatus,
}: { runId: string; initialProposals: Proposal[]; runStatus: string }) {
  const router = useRouter();
  const [proposals, setProposals] = useState<Proposal[]>(initialProposals);
  const [filter, setFilter] = useState<StatusFilter>('PENDING');
  const [gem, setGem] = useState<GemFilters>(EMPTY_FILTERS);
  const [gemOpen, setGemOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('changePct');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Apply modal state
  const [showApply, setShowApply] = useState(false);
  const [passcode, setPasscode] = useState('');

  // Edit-single-proposal modal state
  const [editing, setEditing] = useState<Proposal | null>(null);
  const [editPpc, setEditPpc] = useState('');
  const [editReason, setEditReason] = useState('');

  // Bulk-discount toolbar state
  const [bulkDiscPct, setBulkDiscPct] = useState('');

  function openEdit(p: Proposal) {
    setEditing(p);
    setEditPpc(String(p.proposedPpc));
    setEditReason(p.reasoning);
    setError(null);
  }

  function clickHeader(key: SortKey) {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  function toggleGem(key: 'shape' | 'color' | 'clarity' | 'lab', value: string) {
    setGem(prev => {
      const arr = prev[key];
      return { ...prev, [key]: arr.includes(value) ? arr.filter(x => x !== value) : [...arr, value] };
    });
  }
  const setGemText = (key: keyof GemFilters, v: string) => setGem(prev => ({ ...prev, [key]: v }));

  const counts = useMemo(() => {
    const c = { PENDING: 0, APPROVED: 0, REJECTED: 0, APPLIED: 0, CHANGED: 0, UNCHANGED: 0 };
    for (const p of proposals) {
      c[p.status]++;
      if (p.proposedPpc !== p.oldPpc) c.CHANGED++; else c.UNCHANGED++;
    }
    return c;
  }, [proposals]);

  // Apply gem filters first, then the status tab.
  const gemFiltered = useMemo(() => {
    const caratMin = gem.caratMin ? Number(gem.caratMin) : null;
    const caratMax = gem.caratMax ? Number(gem.caratMax) : null;
    const ppcMin   = gem.ppcMin   ? Number(gem.ppcMin)   : null;
    const ppcMax   = gem.ppcMax   ? Number(gem.ppcMax)   : null;
    const discMin  = gem.discMin  ? Number(gem.discMin)  : null;
    const discMax  = gem.discMax  ? Number(gem.discMax)  : null;
    const q = gem.stoneIdQuery.trim().toLowerCase();
    return proposals.filter(p => {
      if (gem.shape.length   && !gem.shape.includes(p.shape))     return false;
      if (gem.color.length   && !gem.color.includes(p.color))     return false;
      if (gem.clarity.length && !gem.clarity.includes(p.clarity)) return false;
      if (gem.lab.length     && (!p.lab || !gem.lab.includes(p.lab))) return false;
      if (caratMin != null && p.carat < caratMin) return false;
      if (caratMax != null && p.carat > caratMax) return false;
      if (ppcMin   != null && p.proposedPpc < ppcMin) return false;
      if (ppcMax   != null && p.proposedPpc > ppcMax) return false;
      if (discMin != null || discMax != null) {
        const disc = p.rapPrice && p.rapPrice > 0
          ? (1 - p.proposedPpc / p.rapPrice) * 100
          : null;
        if (disc == null) return false;
        if (discMin != null && disc < discMin) return false;
        if (discMax != null && disc > discMax) return false;
      }
      if (q && !p.stoneId.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [proposals, gem]);

  const filtered = useMemo(() => {
    const base = gemFiltered;
    let arr: Proposal[];
    if (filter === 'ALL')            arr = base;
    else if (filter === 'CHANGED')   arr = base.filter(p => p.proposedPpc !== p.oldPpc);
    else if (filter === 'UNCHANGED') arr = base.filter(p => p.proposedPpc === p.oldPpc);
    else                              arr = base.filter(p => p.status === filter);

    // Sort
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...arr].sort((a, b) => {
      let av: any, bv: any;
      switch (sortKey) {
        case 'discOffRap':
          av = discOffRapFor(a) ?? -Infinity;
          bv = discOffRapFor(b) ?? -Infinity;
          break;
        case 'rapPrice':
          av = a.rapPrice ?? -Infinity;
          bv = b.rapPrice ?? -Infinity;
          break;
        default:
          av = a[sortKey as keyof Proposal];
          bv = b[sortKey as keyof Proposal];
      }
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir;
      if (av == null) return 1; if (bv == null) return -1;
      return (av - bv) * dir;
    });
  }, [gemFiltered, filter, sortKey, sortDir]);

  // Disc-off-Rap histogram on the filtered subset (so it always reflects the current view).
  const histogram = useMemo(() => {
    return DISC_BUCKETS.map(b => ({
      ...b,
      count: gemFiltered.filter(p => {
        const d = discOffRapFor(p);
        return d != null && d >= b.min && d < b.max;
      }).length,
    }));
  }, [gemFiltered]);
  const noRapCount = useMemo(() => gemFiltered.filter(p => p.rapPrice == null).length, [gemFiltered]);

  // Counts shown on the status tabs reflect the gem-filter context so the
  // numbers always match what the user sees.
  const tabCounts = useMemo(() => {
    const c = { PENDING: 0, APPROVED: 0, REJECTED: 0, APPLIED: 0, CHANGED: 0, UNCHANGED: 0 };
    for (const p of gemFiltered) {
      c[p.status]++;
      if (p.proposedPpc !== p.oldPpc) c.CHANGED++; else c.UNCHANGED++;
    }
    return c;
  }, [gemFiltered]);

  const activeGemCount =
    gem.shape.length + gem.color.length + gem.clarity.length + gem.lab.length +
    (gem.caratMin ? 1 : 0) + (gem.caratMax ? 1 : 0) +
    (gem.ppcMin   ? 1 : 0) + (gem.ppcMax   ? 1 : 0) +
    (gem.discMin  ? 1 : 0) + (gem.discMax  ? 1 : 0) +
    (gem.stoneIdQuery ? 1 : 0);

  async function saveEdit() {
    if (!editing) return;
    setError(null);
    const ppc = Number(editPpc);
    if (!Number.isFinite(ppc) || ppc <= 0) { setError('Enter a positive $/ct.'); return; }
    if (!editReason.trim()) { setError('Reasoning is required.'); return; }
    setBusy(true);
    const res = await fetch(`/api/admin/pricing/proposals/${editing.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proposedPpc: ppc, reasoning: editReason }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `Update failed (${res.status})`);
      return;
    }
    const oldPpcVal = editing.oldPpc;
    const changePct = oldPpcVal > 0 ? ((ppc - oldPpcVal) / oldPpcVal) * 100 : 0;
    setProposals(prev => prev.map(p => p.id === editing.id
      ? { ...p, proposedPpc: ppc, changePct, reasoning: editReason.trim() }
      : p,
    ));
    setEditing(null);
  }

  async function bulkSetDiscount() {
    setError(null);
    const d = Number(bulkDiscPct);
    if (!Number.isFinite(d) || d < 0 || d >= 100) {
      setError('Enter a discount percentage between 0 and 99.');
      return;
    }
    const ids = filtered.filter(p => p.status !== 'APPLIED').map(p => p.id);
    if (ids.length === 0) { setError('No editable proposals in current view.'); return; }
    const scopeLabel = activeGemCount > 0 || filter !== 'ALL' ? 'current view' : 'all proposals';
    if (!confirm(`Set ${d}% off Rap for ${ids.length} proposals (${scopeLabel})?`)) return;

    setBusy(true);
    const res = await fetch(`/api/admin/pricing/runs/${runId}/bulk-disc`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids, discountOffRapPct: d }),
    });
    setBusy(false);
    if (!res.ok) { setError(`Bulk discount failed`); return; }
    // Refresh from server — easier than recomputing.
    router.refresh();
    setBulkDiscPct('');
  }

  async function decide(proposalId: string, decision: 'APPROVED' | 'REJECTED' | 'PENDING') {
    setError(null);
    const res = await fetch(`/api/admin/pricing/runs/${runId}/decide`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proposalId, decision }),
    });
    if (!res.ok) { setError(`Failed to update (${res.status})`); return; }
    setProposals(prev => prev.map(p => p.id === proposalId ? { ...p, status: decision } : p));
  }

  async function bulk(action: 'APPROVE' | 'REJECT') {
    setError(null);
    // If gem filters are active, only act on the visible PENDING subset; otherwise act on every pending row in the run.
    const filteredPending = gemFiltered.filter(p => p.status === 'PENDING');
    const scoped = activeGemCount > 0;
    const targetCount = scoped ? filteredPending.length : counts.PENDING;
    if (targetCount === 0) { setError('No PENDING proposals in current view.'); return; }
    const scopeLabel = scoped ? `${targetCount} stones matching current filters` : `ALL ${targetCount} pending stones in this run`;
    if (!confirm(`${action} ${scopeLabel}?`)) return;

    setBusy(true);
    const body: any = scoped
      ? { ids: filteredPending.map(p => p.id), decision: action === 'APPROVE' ? 'APPROVED' : 'REJECTED' }
      : { all: action };
    const res = await fetch(`/api/admin/pricing/runs/${runId}/decide`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) { setError(`Bulk ${action.toLowerCase()} failed`); return; }
    const target = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const idSet = scoped ? new Set(filteredPending.map(p => p.id)) : null;
    setProposals(prev => prev.map(p => {
      if (p.status !== 'PENDING') return p;
      if (idSet && !idSet.has(p.id)) return p;
      return { ...p, status: target };
    }));
  }

  async function apply() {
    if (!passcode) { setError('Passcode required.'); return; }
    setBusy(true); setError(null);
    const res = await fetch(`/api/admin/pricing/runs/${runId}/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passcode }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error ?? `Apply failed (${res.status})`); return; }
    setProposals(prev => prev.map(p => p.status === 'APPROVED' ? { ...p, status: 'APPLIED' as const } : p));
    setShowApply(false); setPasscode('');
    router.refresh();
    alert(`Applied ${data.applied} price changes to live inventory.`);
  }

  const isAppliedRun = runStatus === 'APPLIED';
  const tabs: Array<{ key: StatusFilter; label: string; count: number }> = [
    { key: 'PENDING', label: 'Pending', count: tabCounts.PENDING },
    { key: 'APPROVED', label: 'Approved', count: tabCounts.APPROVED },
    { key: 'REJECTED', label: 'Rejected', count: tabCounts.REJECTED },
    { key: 'APPLIED', label: 'Applied', count: tabCounts.APPLIED },
    { key: 'CHANGED', label: 'Changed', count: tabCounts.CHANGED },
    { key: 'UNCHANGED', label: 'Unchanged', count: tabCounts.UNCHANGED },
    { key: 'ALL', label: 'All', count: gemFiltered.length },
  ];

  const bulkPendingInScope = activeGemCount > 0
    ? gemFiltered.filter(p => p.status === 'PENDING').length
    : counts.PENDING;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total proposals" value={proposals.length} />
        <Stat label="Pending review" value={counts.PENDING} tone="amber" />
        <Stat label="Approved" value={counts.APPROVED} tone="green" />
        <Stat label="Applied" value={counts.APPLIED} tone="brand" />
      </div>

      {/* ─── Gem filter bar ─── */}
      <div className="card overflow-hidden">
        <button onClick={() => setGemOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 py-3 bg-brand-50 hover:bg-brand-100 transition">
          <span className="text-sm font-medium text-brand-900">
            Filter proposals
            {activeGemCount > 0 && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs bg-gold-500/20 text-gold-700">
                {activeGemCount} active · {gemFiltered.length} of {proposals.length}
              </span>
            )}
          </span>
          <span className="text-brand-700 text-xs">{gemOpen ? '▲ Collapse' : '▼ Expand'}</span>
        </button>

        {gemOpen && (
          <div className="p-4 space-y-3 text-sm">
            <PillRow label="Shape"   options={OPTIONS.shape}   selected={gem.shape}   onToggle={v => toggleGem('shape', v)} />
            <PillRow label="Color"   options={OPTIONS.color}   selected={gem.color}   onToggle={v => toggleGem('color', v)} />
            <PillRow label="Clarity" options={OPTIONS.clarity} selected={gem.clarity} onToggle={v => toggleGem('clarity', v)} />
            <PillRow label="Lab"     options={OPTIONS.lab}     selected={gem.lab}     onToggle={v => toggleGem('lab', v)} />

            <div className="grid md:grid-cols-4 gap-3">
              <RangeInput label="Carat" min={gem.caratMin} max={gem.caratMax}
                          onMin={v => setGemText('caratMin', v)} onMax={v => setGemText('caratMax', v)} step="0.01" />
              <RangeInput label="New $/ct" min={gem.ppcMin} max={gem.ppcMax}
                          onMin={v => setGemText('ppcMin', v)} onMax={v => setGemText('ppcMax', v)} step="1" />
              <RangeInput label="Disc off Rap %" min={gem.discMin} max={gem.discMax}
                          onMin={v => setGemText('discMin', v)} onMax={v => setGemText('discMax', v)} step="1" />
              <div>
                <Label>Stone ID search</Label>
                <input value={gem.stoneIdQuery} onChange={e => setGemText('stoneIdQuery', e.target.value)}
                       placeholder="e.g. LGSTK001 or 0042" className="input" />
              </div>
            </div>

            {activeGemCount > 0 && (
              <div className="flex justify-end">
                <button onClick={() => setGem(EMPTY_FILTERS)} className="btn-outline text-xs">
                  Clear all filters
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Disc-off-Rap distribution histogram (click to filter) ─── */}
      {gemFiltered.length > 0 && (
        <div className="card p-3">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-xs uppercase tracking-widest text-brand-700">
              Distribution — discount off Rap
            </span>
            {noRapCount > 0 && (
              <span className="text-xs text-brand-700/70">
                {noRapCount} proposal{noRapCount === 1 ? '' : 's'} have no Rap match
              </span>
            )}
          </div>
          <div className="flex items-end gap-1 h-20">
            {histogram.map(b => {
              const maxCount = Math.max(1, ...histogram.map(x => x.count));
              const h = (b.count / maxCount) * 100;
              const isActive = gem.discMin === String(b.min) && gem.discMax === String(b.max);
              return (
                <button key={b.label}
                        onClick={() => setGem(prev => ({ ...prev, discMin: String(b.min), discMax: String(b.max) }))}
                        className="flex-1 flex flex-col items-center group">
                  <div className="text-[10px] text-brand-700 mb-0.5 group-hover:text-gold-700">
                    {b.count}
                  </div>
                  <div className={`w-full rounded-t transition ${
                    isActive
                      ? 'bg-gold-500'
                      : b.min >= 90 ? 'bg-emerald-400/70 group-hover:bg-emerald-500'
                      : b.min >= 80 ? 'bg-amber-400/70 group-hover:bg-amber-500'
                      : 'bg-rose-400/70 group-hover:bg-rose-500'
                  }`} style={{ height: `${h}%`, minHeight: b.count > 0 ? '4px' : '1px' }} />
                  <div className="text-[10px] text-brand-700 mt-0.5">{b.label}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Bulk discount toolbar (acts on current view) ─── */}
      {!isAppliedRun && (
        <div className="card p-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-xs uppercase tracking-widest text-brand-700">
            Set discount for {activeGemCount > 0 || filter !== 'ALL' ? <b>current view</b> : <b>everything</b>}
          </span>
          <input type="number" min="0" max="99" step="0.5"
                 value={bulkDiscPct} onChange={e => setBulkDiscPct(e.target.value)}
                 placeholder="e.g. 96"
                 className="input max-w-[100px]" />
          <span className="text-xs text-brand-700">% off Rap</span>
          <button onClick={bulkSetDiscount} disabled={busy || !bulkDiscPct} className="btn-gold">
            Apply to {filtered.filter(p => p.status !== 'APPLIED').length} proposals
          </button>
          <span className="text-xs text-brand-700/70 italic">
            Skips APPLIED rows. Falls back to current $/ct as basis if no Rap match.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setFilter(t.key)}
                    className={filter === t.key ? 'btn-primary' : 'btn-outline'}>
              {t.label} ({t.count})
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {!isAppliedRun && bulkPendingInScope > 0 && (
            <>
              <button onClick={() => bulk('APPROVE')} disabled={busy} className="btn-gold">
                ✓ Approve {activeGemCount > 0 ? `filtered (${bulkPendingInScope})` : 'all pending'}
              </button>
              <button onClick={() => bulk('REJECT')} disabled={busy} className="btn-outline">
                ✗ Reject {activeGemCount > 0 ? `filtered (${bulkPendingInScope})` : 'all pending'}
              </button>
            </>
          )}
          {!isAppliedRun && counts.APPROVED > 0 && (
            <button onClick={() => setShowApply(true)} disabled={busy} className="btn-primary">
              ⚡ Push {counts.APPROVED} approved → Inventory
            </button>
          )}
        </div>
      </div>

      {error && <div className="text-rose-700 text-sm bg-rose-50 p-2 rounded">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-brand-50 text-brand-700 text-left">
            <tr>
              <SortHeader label="Stone"          k="stoneId"     sortKey={sortKey} sortDir={sortDir} onClick={clickHeader} />
              <SortHeader label="Spec"           k="carat"       sortKey={sortKey} sortDir={sortDir} onClick={clickHeader} />
              <SortHeader label="Rap"            k="rapPrice"    sortKey={sortKey} sortDir={sortDir} onClick={clickHeader} align="right" />
              <SortHeader label="Disc off Rap"   k="discOffRap"  sortKey={sortKey} sortDir={sortDir} onClick={clickHeader} align="right" />
              <SortHeader label="Old $/ct"       k="oldPpc"      sortKey={sortKey} sortDir={sortDir} onClick={clickHeader} align="right" />
              <SortHeader label="New $/ct (PPC)" k="proposedPpc" sortKey={sortKey} sortDir={sortDir} onClick={clickHeader} align="right" />
              <SortHeader label="∆ vs old"       k="changePct"   sortKey={sortKey} sortDir={sortDir} onClick={clickHeader} align="right" />
              <th className="px-3 py-2">Reasoning</th>
              <SortHeader label="Status"         k="status"      sortKey={sortKey} sortDir={sortDir} onClick={clickHeader} />
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const change = p.proposedPpc - p.oldPpc;
              const cls = change < 0 ? 'text-rose-700' : change > 0 ? 'text-emerald-700' : 'text-brand-700';
              const disc = discOffRapFor(p);
              const noRap = p.rapPrice == null;
              const deepCut = p.changePct < -20;
              const bigRaise = p.changePct > 20;
              return (
                <tr key={p.id} className="border-t border-brand-100 align-top hover:bg-brand-50/50">
                  <td className="px-3 py-2 font-mono text-xs">
                    {p.stoneId}
                    <div className="flex gap-1 mt-0.5">
                      {noRap && <Badge tone="brand" title="No matching Rap rate for this stone's category">📭 no Rap</Badge>}
                      {deepCut && <Badge tone="rose" title="Big drop vs current price">⚠ deep cut</Badge>}
                      {bigRaise && <Badge tone="green" title="Engine raised the price (uncommon)">▲ raise</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {p.shape} {p.carat.toFixed(2)}ct {p.color}/{p.clarity}
                    {p.lab && <span className="block text-brand-700/70">{p.lab}</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    {p.rapPrice ? fmtUsd(p.rapPrice) : <span className="text-brand-700/40">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    {disc == null
                      ? <span className="text-brand-700/40">—</span>
                      : <span className={disc >= 90 ? 'text-emerald-700 font-medium' : disc >= 75 ? 'text-amber-700' : 'text-brand-900'}>
                          {disc.toFixed(1)}%
                        </span>
                    }
                  </td>
                  <td className="px-3 py-2 text-right">{fmtUsd(p.oldPpc)}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtUsd(p.proposedPpc)}</td>
                  <td className={`px-3 py-2 text-right ${cls}`}>
                    {p.changePct === 0 ? '—' : `${p.changePct.toFixed(1)}%`}
                  </td>
                  <td className="px-3 py-2 text-xs max-w-[300px]">
                    <div className="line-clamp-3" title={p.reasoning}>{p.reasoning}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${STATUS_CLS[p.status]}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-xs">
                    {p.status === 'APPLIED' || isAppliedRun ? (
                      <span className="text-brand-700">—</span>
                    ) : (
                      <div className="flex flex-col gap-1 items-end">
                        <button onClick={() => openEdit(p)} className="text-brand-900 hover:text-gold-600 hover:underline">
                          ✎ Edit
                        </button>
                        {p.status === 'PENDING' ? (
                          <div className="flex gap-2">
                            <button onClick={() => decide(p.id, 'APPROVED')} className="text-emerald-700 hover:underline">Approve</button>
                            <button onClick={() => decide(p.id, 'REJECTED')} className="text-rose-700 hover:underline">Reject</button>
                          </div>
                        ) : (
                          <button onClick={() => decide(p.id, 'PENDING')} className="text-brand-700 hover:underline">Reset</button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="text-center py-8 text-brand-700 text-sm">No proposals match this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Per-stone edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-brand-900/60 flex items-center justify-center z-50 p-4">
          <div className="card p-6 w-full max-w-lg space-y-4">
            <div>
              <h2 className="font-serif text-xl">Edit proposal — {editing.stoneId}</h2>
              <p className="text-sm text-brand-700 mt-1">
                {editing.shape} {editing.carat.toFixed(2)}ct {editing.color}/{editing.clarity}
                {editing.lab && ` · ${editing.lab}`}
              </p>
              <p className="text-xs text-brand-700/70 mt-1">
                Rap {editing.rapPrice ? `$${editing.rapPrice}/ct` : '—'} ·
                Current $/ct {fmtUsd(editing.oldPpc)} ·
                Engine proposed {fmtUsd(editing.proposedPpc)}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <Label>New $/ct</Label>
                <input type="number" step="1" min="1" autoFocus
                       value={editPpc} onChange={e => setEditPpc(e.target.value)}
                       className="input" />
              </label>
              <div>
                <Label>Quick set (% off Rap)</Label>
                <div className="flex flex-wrap gap-1">
                  {[97, 95, 92, 90, 85].map(d => (
                    <button key={d} type="button"
                            disabled={editing.rapPrice == null}
                            onClick={() => {
                              const basis = editing.rapPrice ?? editing.oldPpc;
                              const v = Math.round(basis * (1 - d / 100) / 5) * 5;
                              setEditPpc(String(Math.max(1, v)));
                            }}
                            className="text-xs px-2 py-1 rounded border border-brand-100 hover:border-gold-500 hover:bg-gold-500/10 disabled:opacity-30">
                      {d}%
                    </button>
                  ))}
                </div>
                {editing.rapPrice == null && <p className="text-xs text-brand-700/60 mt-1">No Rap match — set manually.</p>}
              </div>
            </div>

            {editing.rapPrice && Number(editPpc) > 0 && (
              <div className="text-xs text-brand-700">
                Implied discount off Rap:{' '}
                <b className={(1 - Number(editPpc) / editing.rapPrice) * 100 >= 90 ? 'text-emerald-700' : 'text-amber-700'}>
                  {((1 - Number(editPpc) / editing.rapPrice) * 100).toFixed(1)}%
                </b>
              </div>
            )}

            <label className="block">
              <Label>Reasoning (required — e.g. cite Nivoda comparable)</Label>
              <textarea value={editReason} onChange={e => setEditReason(e.target.value)}
                        rows={3} className="input text-sm"
                        placeholder="e.g. Nivoda has 3 similar at $325/ct, our cost basis is $280, going 95% off Rap." />
            </label>

            {error && <div className="text-rose-700 text-sm">{error}</div>}

            <div className="flex gap-3 justify-end">
              <button disabled={busy} onClick={() => { setEditing(null); setError(null); }} className="btn-outline">Cancel</button>
              <button onClick={saveEdit} disabled={busy} className="btn-primary">
                {busy ? 'Saving…' : 'Save override'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Apply confirmation modal */}
      {showApply && (
        <div className="fixed inset-0 bg-brand-900/60 flex items-center justify-center z-50 p-4">
          <div className="card p-6 w-full max-w-sm space-y-4">
            <div>
              <h2 className="font-serif text-xl">Push to inventory</h2>
              <p className="text-sm text-brand-700 mt-1">
                You're about to update <b>{counts.APPROVED}</b> stone{counts.APPROVED === 1 ? '' : 's'} on the live storefront.
                Enter your admin password to confirm.
              </p>
            </div>
            <input type="password" autoFocus className="input" placeholder="Admin password"
                   value={passcode} onChange={e => setPasscode(e.target.value)}
                   onKeyDown={e => { if (e.key === 'Enter') apply(); }} />
            {error && <div className="text-rose-700 text-sm">{error}</div>}
            <div className="flex gap-3 justify-end">
              <button disabled={busy} onClick={() => { setShowApply(false); setPasscode(''); setError(null); }}
                      className="btn-outline">Cancel</button>
              <button onClick={apply} disabled={busy} className="btn-primary">
                {busy ? 'Applying…' : 'Confirm & apply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'amber' | 'rose' | 'brand' }) {
  const cls = tone === 'green' ? 'text-emerald-700'
    : tone === 'amber' ? 'text-amber-700'
    : tone === 'rose' ? 'text-rose-700'
    : tone === 'brand' ? 'text-brand-700' : 'text-brand-900';
  return (
    <div className="card p-3">
      <div className="text-xs uppercase tracking-widest text-brand-700">{label}</div>
      <div className={`text-2xl font-serif mt-0.5 ${cls}`}>{value}</div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs uppercase tracking-widest text-brand-700 mb-1">{children}</div>;
}

function SortHeader({
  label, k, sortKey, sortDir, onClick, align,
}: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: SortDir;
  onClick: (k: SortKey) => void; align?: 'right';
}) {
  const active = sortKey === k;
  const indicator = !active ? '' : sortDir === 'asc' ? ' ▲' : ' ▼';
  return (
    <th className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button onClick={() => onClick(k)} className={`hover:text-gold-700 ${active ? 'text-gold-700' : ''}`}>
        {label}{indicator}
      </button>
    </th>
  );
}

function Badge({ tone, title, children }: {
  tone: 'green' | 'amber' | 'rose' | 'brand'; title?: string; children: React.ReactNode;
}) {
  const cls = {
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    rose:  'bg-rose-50 text-rose-700',
    brand: 'bg-brand-50 text-brand-700',
  }[tone];
  return (
    <span title={title} className={`inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium ${cls}`}>
      {children}
    </span>
  );
}

function PillRow({
  label, options, selected, onToggle,
}: { label: string; options: string[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <div>
      <Label>
        {label}
        {selected.length > 0 && <span className="ml-2 text-gold-600">({selected.length})</span>}
      </Label>
      <div className="flex flex-wrap gap-1.5">
        {options.map(opt => {
          const on = selected.includes(opt);
          return (
            <button key={opt} type="button" onClick={() => onToggle(opt)}
                    className={`text-xs px-2 py-1 rounded border transition ${
                      on
                        ? 'bg-brand-900 border-brand-900 text-white'
                        : 'border-brand-100 text-brand-700 hover:border-gold-500 hover:bg-gold-500/10'
                    }`}>
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RangeInput({
  label, min, max, onMin, onMax, step,
}: { label: string; min: string; max: string; onMin: (v: string) => void; onMax: (v: string) => void; step?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-1 items-center">
        <input type="number" step={step} value={min} onChange={e => onMin(e.target.value)}
               placeholder="min" className="input" />
        <span className="text-brand-700">–</span>
        <input type="number" step={step} value={max} onChange={e => onMax(e.target.value)}
               placeholder="max" className="input" />
      </div>
    </div>
  );
}
