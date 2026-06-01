'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Summary = {
  filename: string; rowsTotal: number; rowsInserted: number;
  rowsUpdated: number; rowsFailed: number;
  errors: Array<{ row: number; error: string }>;
};

export function RapUploadForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ files: Summary[]; totals: Omit<Summary, 'filename' | 'errors'>; sheetDate: string } | null>(null);
  const [sheetDate, setSheetDate] = useState(new Date().toISOString().slice(0, 10));

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null); setResult(null);

    const fd = new FormData(e.currentTarget);
    const files = fd.getAll('files');
    if (!files.length || !(files[0] instanceof File) || (files[0] as File).size === 0) {
      setError('Choose at least one file.');
      setBusy(false);
      return;
    }
    fd.set('sheetDate', sheetDate);

    const res = await fetch('/api/admin/rap/import', { method: 'POST', body: fd });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error ?? `Upload failed (${res.status}).`); return; }
    setResult(data);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap gap-3 items-end">
        <label className="block">
          <span className="text-xs uppercase tracking-widest text-brand-700">Sheet date</span>
          <input type="date" value={sheetDate} onChange={e => setSheetDate(e.target.value)}
                 className="input mt-1 max-w-[160px]" />
        </label>
        <label className="block flex-1">
          <span className="text-xs uppercase tracking-widest text-brand-700">Rap file(s) — pick one or more</span>
          <input name="files" type="file" accept=".xlsx,.xls,.csv" multiple required
                 className="block w-full text-sm mt-1" />
        </label>
        <button className="btn-primary" disabled={busy}>
          {busy ? 'Uploading…' : 'Upload Rap rates'}
        </button>
      </div>

      {error && <div className="text-rose-700 text-sm bg-rose-50 p-2 rounded">{error}</div>}

      {result && (
        <div className="card p-4 mt-3">
          <div className="text-xs uppercase tracking-widest text-brand-700 mb-2">
            Summary — sheet date {new Date(result.sheetDate).toLocaleDateString()}
          </div>
          <div className="grid grid-cols-4 gap-3 text-center">
            <Stat label="Total" value={result.totals.rowsTotal} />
            <Stat label="Inserted" value={result.totals.rowsInserted} tone="green" />
            <Stat label="Updated" value={result.totals.rowsUpdated} tone="amber" />
            <Stat label="Failed" value={result.totals.rowsFailed} tone="rose" />
          </div>
          {result.files.map((f, i) => (
            <div key={i} className="mt-3 border-t border-brand-100 pt-2">
              <div className="text-xs"><span className="font-mono">{f.filename}</span> — {f.rowsInserted} new · {f.rowsUpdated} updated · {f.rowsFailed} failed</div>
              {f.errors.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-rose-700">{f.errors.length} error(s)</summary>
                  <ul className="text-xs font-mono mt-1 max-h-40 overflow-auto">
                    {f.errors.map((e, k) => <li key={k}>row {e.row}: {e.error}</li>)}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </form>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'amber' | 'rose' }) {
  const cls = tone === 'green' ? 'text-emerald-700'
    : tone === 'amber' ? 'text-amber-700'
    : tone === 'rose' ? 'text-rose-700' : 'text-brand-900';
  return (
    <div>
      <div className={`text-2xl font-serif ${cls}`}>{value}</div>
      <div className="text-xs uppercase tracking-widest text-brand-700">{label}</div>
    </div>
  );
}
