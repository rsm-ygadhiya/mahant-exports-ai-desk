'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Filters = {
  shape: string[];
  color: string[];
  clarity: string[];
  cut: string[];
  polish: string[];
  symmetry: string[];
  fluorescence: string[];
  lab: string[];
  statusList: string[];
  stoneIds: string[];
  cert_no: string;
  carat_min: string; carat_max: string;
  ppc_min: string;   ppc_max: string;
};

// Tailored to the actual values present in Mahant's inventory (run a groupBy
// in DB to keep these in sync if new shapes/grades show up).
const OPTIONS = {
  shape:        ['Round', 'Princess', 'Oval', 'Emerald', 'Radiant', 'Pear', 'Heart', 'Cushion', 'Marquise', 'Asscher'],
  color:        ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'],
  clarity:      ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'SI3', 'I1'],
  cut:          ['Excellent', 'Very Good', 'Good', 'Fair', 'Poor', 'EX', 'VG', 'GD'],
  polish:       ['Excellent', 'Very Good', 'Good', 'Fair', 'EX', 'VG', 'GD'],
  symmetry:     ['Excellent', 'Very Good', 'Good', 'Fair', 'EX', 'VG', 'GD'],
  fluorescence: ['None', 'Faint', 'Medium', 'Strong', 'Very Strong', 'NON', 'FNT', 'MED', 'STR'],
  lab:          ['IGI', 'GIA', 'GCAL', 'HRD', 'SGL'],
  status:       ['NOT_LIVE', 'AVAILABLE', 'HOLD', 'SOLD'],
};

export function FilterBar({ initial }: { initial: Filters }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [f, setF] = useState<Filters>(initial);
  const [open, setOpen] = useState(true);

  function toggle(key: keyof Filters, value: string) {
    setF(prev => {
      const arr = prev[key] as string[];
      const next = arr.includes(value) ? arr.filter(x => x !== value) : [...arr, value];
      return { ...prev, [key]: next };
    });
  }

  function setText(key: keyof Filters, value: string) {
    setF(prev => ({ ...prev, [key]: value as any }));
  }

  function apply() {
    const sp = new URLSearchParams();
    if (f.stoneIds.length) sp.set('stone_ids', f.stoneIds.join('\n'));
    if (f.cert_no)         sp.set('cert_no',   f.cert_no);
    for (const k of ['shape', 'color', 'clarity', 'cut', 'polish', 'symmetry', 'fluorescence', 'lab'] as const) {
      if ((f[k] as string[]).length) sp.set(k, (f[k] as string[]).join(','));
    }
    if (f.statusList.length) sp.set('status', f.statusList.join(','));
    if (f.carat_min) sp.set('carat_min', f.carat_min);
    if (f.carat_max) sp.set('carat_max', f.carat_max);
    if (f.ppc_min)   sp.set('ppc_min',   f.ppc_min);
    if (f.ppc_max)   sp.set('ppc_max',   f.ppc_max);
    startTransition(() => router.push('/admin/diamonds' + (sp.toString() ? '?' + sp.toString() : '')));
  }

  function clearAll() {
    setF({
      shape: [], color: [], clarity: [], cut: [], polish: [], symmetry: [],
      fluorescence: [], lab: [], statusList: [], stoneIds: [],
      cert_no: '', carat_min: '', carat_max: '', ppc_min: '', ppc_max: '',
    });
    startTransition(() => router.push('/admin/diamonds'));
  }

  const activeCount =
    f.shape.length + f.color.length + f.clarity.length + f.cut.length + f.polish.length +
    f.symmetry.length + f.fluorescence.length + f.lab.length + f.statusList.length +
    (f.stoneIds.length ? 1 : 0) + (f.cert_no ? 1 : 0) +
    (f.carat_min ? 1 : 0) + (f.carat_max ? 1 : 0) +
    (f.ppc_min ? 1 : 0) + (f.ppc_max ? 1 : 0);

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 py-3 bg-brand-50 hover:bg-brand-100 transition">
        <span className="text-sm font-medium text-brand-900">
          Filters {activeCount > 0 && <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs bg-gold-500/20 text-gold-700">{activeCount} active</span>}
        </span>
        <span className="text-brand-700 text-xs">{open ? '▲ Collapse' : '▼ Expand'}</span>
      </button>

      {open && (
        <div className="p-4 space-y-4 text-sm">

          {/* Stone IDs textarea — multi-stone search */}
          <div>
            <Label>Search by Stone ID</Label>
            <textarea
              value={f.stoneIds.join('\n')}
              onChange={e => setText('stoneIds', e.target.value.split(/[\s,;]+/).filter(Boolean).join('\n') as any)}
              placeholder={'LGSTK00001  LGSTK00012  (paste many — newlines, commas, or spaces)'}
              rows={2}
              className="input font-mono text-xs"
            />
          </div>

          <PillRow label="Shape"    options={OPTIONS.shape}    selected={f.shape}    onToggle={v => toggle('shape', v)} />
          <PillRow label="Color"    options={OPTIONS.color}    selected={f.color}    onToggle={v => toggle('color', v)} />
          <PillRow label="Clarity"  options={OPTIONS.clarity}  selected={f.clarity}  onToggle={v => toggle('clarity', v)} />

          <div className="grid md:grid-cols-2 gap-4">
            <PillRow label="Cut"        options={OPTIONS.cut}        selected={f.cut}        onToggle={v => toggle('cut', v)} compact />
            <PillRow label="Polish"     options={OPTIONS.polish}     selected={f.polish}     onToggle={v => toggle('polish', v)} compact />
            <PillRow label="Symmetry"   options={OPTIONS.symmetry}   selected={f.symmetry}   onToggle={v => toggle('symmetry', v)} compact />
            <PillRow label="Fluorescence" options={OPTIONS.fluorescence} selected={f.fluorescence} onToggle={v => toggle('fluorescence', v)} compact />
            <PillRow label="Lab"        options={OPTIONS.lab}        selected={f.lab}        onToggle={v => toggle('lab', v)} compact />
            <PillRow label="Status"     options={OPTIONS.status}     selected={f.statusList} onToggle={v => toggle('statusList', v)} compact />
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <RangeInput label="Carat" min={f.carat_min} max={f.carat_max}
                        onMin={v => setText('carat_min', v)} onMax={v => setText('carat_max', v)} step="0.01" />
            <RangeInput label="$/ct"  min={f.ppc_min}   max={f.ppc_max}
                        onMin={v => setText('ppc_min', v)} onMax={v => setText('ppc_max', v)} step="1" />
            <div>
              <Label>Cert No</Label>
              <input value={f.cert_no} onChange={e => setText('cert_no', e.target.value)}
                     placeholder="Substring match" className="input" />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-brand-100">
            <p className="text-xs text-brand-700">
              {activeCount === 0
                ? 'No filters active — showing the full inventory.'
                : `${activeCount} filter${activeCount === 1 ? '' : 's'} active.`}
            </p>
            <div className="flex gap-2">
              <button onClick={clearAll} disabled={pending} className="btn-outline">Clear all</button>
              <button onClick={apply} disabled={pending} className="btn-primary">
                {pending ? 'Loading…' : 'Apply filters'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs uppercase tracking-widest text-brand-700 mb-1">{children}</div>;
}

function PillRow({
  label, options, selected, onToggle, compact = false,
}: {
  label: string; options: string[]; selected: string[];
  onToggle: (v: string) => void; compact?: boolean;
}) {
  return (
    <div>
      <Label>{label}{selected.length > 0 && <span className="ml-2 text-gold-600">({selected.length})</span>}</Label>
      <div className={`flex flex-wrap ${compact ? 'gap-1' : 'gap-1.5'}`}>
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
