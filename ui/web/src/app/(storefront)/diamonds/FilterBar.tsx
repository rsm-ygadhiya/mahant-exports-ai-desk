'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

const SHAPES = ['Round', 'Princess', 'Cushion', 'Oval', 'Emerald', 'Pear', 'Marquise', 'Radiant', 'Heart', 'Asscher'];
const COLORS = ['D', 'E', 'F', 'G', 'H', 'I', 'J'];
const CLARITIES = ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'];
const LABS = ['IGI', 'GIA', 'GCAL'];

export function FilterBar() {
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  const get = (k: string) => sp.get(k) ?? '';
  const setMany = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    next.delete('page');
    startTransition(() => router.push(`/diamonds?${next.toString()}`));
  };

  const toggleCsv = (key: string, value: string) => {
    const cur = (get(key) ? get(key).split(',') : []).filter(Boolean);
    const has = cur.includes(value);
    const nextList = has ? cur.filter(x => x !== value) : [...cur, value];
    setMany({ [key]: nextList.length ? nextList.join(',') : undefined });
  };

  const isOn = (key: string, val: string) => get(key).split(',').includes(val);

  const [carat, setCarat] = useState({ min: get('carat_min'), max: get('carat_max') });
  const [ppc, setPpc] = useState({ min: get('ppc_min'), max: get('ppc_max') });

  return (
    <div className="card p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Label>Shape</Label>
        {SHAPES.map(s => (
          <Chip key={s} active={isOn('shape', s)} onClick={() => toggleCsv('shape', s)}>{s}</Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Label>Color</Label>
        {COLORS.map(s => (
          <Chip key={s} active={isOn('color', s)} onClick={() => toggleCsv('color', s)}>{s}</Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Label>Clarity</Label>
        {CLARITIES.map(s => (
          <Chip key={s} active={isOn('clarity', s)} onClick={() => toggleCsv('clarity', s)}>{s}</Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Label>Lab</Label>
        {LABS.map(s => (
          <Chip key={s} active={isOn('lab', s)} onClick={() => toggleCsv('lab', s)}>{s}</Chip>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <RangeInput label="Carat" min={carat.min} max={carat.max}
          onChange={(min, max) => setCarat({ min, max })}
          onCommit={() => setMany({ carat_min: carat.min || undefined, carat_max: carat.max || undefined })} />
        <RangeInput label="$/ct" min={ppc.min} max={ppc.max}
          onChange={(min, max) => setPpc({ min, max })}
          onCommit={() => setMany({ ppc_min: ppc.min || undefined, ppc_max: ppc.max || undefined })} />
        <label className="text-sm">
          <span className="text-brand-700">Cert No</span>
          <input className="input mt-1" defaultValue={get('cert_no')}
            onBlur={e => setMany({ cert_no: e.target.value || undefined })} />
        </label>
        <label className="text-sm">
          <span className="text-brand-700">Sort</span>
          <select className="input mt-1" defaultValue={get('sort') || 'new'}
                  onChange={e => setMany({ sort: e.target.value })}>
            <option value="new">New arrivals</option>
            <option value="best_deal">Best deal</option>
            <option value="ppc_asc">$/ct low → high</option>
            <option value="ppc_desc">$/ct high → low</option>
            <option value="carat_asc">Carat low → high</option>
            <option value="carat_desc">Carat high → low</option>
          </select>
        </label>
      </div>

      {sp.toString() && (
        <button onClick={() => router.push('/diamonds')}
                className="text-xs text-brand-700 underline">Clear all filters</button>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-xs uppercase tracking-widest text-brand-700 mr-1">{children}</span>;
}

function Chip({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick}
            className={`px-3 py-1 rounded-full text-xs border transition ${
              active ? 'bg-brand-700 text-white border-brand-700' : 'bg-white text-brand-700 border-brand-200 hover:border-brand-500'
            }`}>
      {children}
    </button>
  );
}

function RangeInput({
  label, min, max, onChange, onCommit,
}: {
  label: string; min: string; max: string;
  onChange: (min: string, max: string) => void;
  onCommit: () => void;
}) {
  return (
    <div className="text-sm">
      <span className="text-brand-700">{label}</span>
      <div className="flex gap-2 mt-1">
        <input className="input" placeholder="min" value={min}
               onChange={e => onChange(e.target.value, max)} onBlur={onCommit} />
        <input className="input" placeholder="max" value={max}
               onChange={e => onChange(min, e.target.value)} onBlur={onCommit} />
      </div>
    </div>
  );
}
