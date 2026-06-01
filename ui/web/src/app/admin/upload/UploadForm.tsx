'use client';
import { useRef, useState } from 'react';

type Mode = 'add' | 'edit';

type Summary = {
  mode: Mode;
  rowsTotal: number; rowsCreated: number; rowsUpdated: number;
  rowsSkipped: number; rowsFailed: number;
  errors: Array<{ row: number; error: string }>;
};

export function UploadForm() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // passcode modal state
  const [pendingMode, setPendingMode] = useState<Mode | null>(null);
  const [passcode, setPasscode] = useState('');

  function trigger(mode: Mode) {
    setError(null);
    if (!fileRef.current?.files?.length) {
      setError('Choose a file first.');
      return;
    }
    setPasscode('');
    setPendingMode(mode);
  }

  async function confirmAndUpload() {
    if (!pendingMode) return;
    if (!passcode) { setError('Passcode required.'); return; }
    const file = fileRef.current?.files?.[0];
    if (!file) { setError('Choose a file first.'); return; }

    setBusy(true); setError(null); setSummary(null);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('mode', pendingMode);
    fd.append('passcode', passcode);

    const res = await fetch('/api/admin/diamonds/import', { method: 'POST', body: fd });
    setBusy(false);

    if (res.status === 403) { setError('Incorrect passcode.'); return; }
    if (!res.ok) { setError(`Upload failed (${res.status}).`); return; }

    setSummary(await res.json());
    setPendingMode(null);
    setPasscode('');
  }

  return (
    <>
      <div className="card p-6 space-y-4">
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" required
               className="block w-full text-sm" />

        <div className="flex flex-wrap gap-3 pt-2">
          <button onClick={() => trigger('add')} disabled={busy} className="btn-primary">
            ＋ Add new only
          </button>
          <button onClick={() => trigger('edit')} disabled={busy} className="btn-gold">
            ✎ Edit all
          </button>
        </div>

        {error && <div className="text-rose-700 text-sm">{error}</div>}
      </div>

      {/* Passcode confirmation modal */}
      {pendingMode && (
        <div className="fixed inset-0 bg-brand-900/60 flex items-center justify-center z-50 p-4">
          <div className="card p-6 w-full max-w-sm space-y-4">
            <div>
              <h2 className="font-serif text-xl">
                Confirm {pendingMode === 'add' ? 'add new' : 'edit all'}
              </h2>
              <p className="text-sm text-brand-700 mt-1">
                {pendingMode === 'add'
                  ? 'New stones will be added. Existing stone IDs will be skipped.'
                  : 'Existing stones will be updated and new stones added.'}
                {' '}Enter your admin password to proceed.
              </p>
            </div>
            <input
              type="password"
              autoFocus
              className="input"
              placeholder="Admin password"
              value={passcode}
              onChange={e => setPasscode(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmAndUpload(); }}
            />
            {error && <div className="text-rose-700 text-sm">{error}</div>}
            <div className="flex gap-3 justify-end">
              <button
                disabled={busy}
                onClick={() => { setPendingMode(null); setPasscode(''); setError(null); }}
                className="btn-outline">
                Cancel
              </button>
              <button onClick={confirmAndUpload} disabled={busy} className="btn-primary">
                {busy ? 'Uploading…' : `Confirm & ${pendingMode === 'add' ? 'add' : 'update'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {summary && (
        <div className="card p-6 mt-4">
          <h2 className="font-serif text-xl mb-1">Import summary</h2>
          <p className="text-xs text-brand-700 mb-3">
            Mode: <b>{summary.mode === 'add' ? 'Add new only' : 'Edit all'}</b>
          </p>
          <div className="grid grid-cols-5 gap-3 text-center">
            <Stat label="Total" value={summary.rowsTotal} />
            <Stat label="Created" value={summary.rowsCreated} tone="green" />
            <Stat label="Updated" value={summary.rowsUpdated} tone="amber" />
            <Stat label="Skipped" value={summary.rowsSkipped} tone="gray" />
            <Stat label="Failed" value={summary.rowsFailed} tone="red" />
          </div>
          {summary.errors.length > 0 && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-brand-700">
                View {summary.errors.length} error(s)
              </summary>
              <ul className="mt-2 space-y-1 text-xs font-mono max-h-64 overflow-auto">
                {summary.errors.map((e, i) => <li key={i}>row {e.row}: {e.error}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </>
  );
}

function Stat({ label, value, tone }: {
  label: string; value: number;
  tone?: 'green' | 'amber' | 'red' | 'gray';
}) {
  const cls = tone === 'green' ? 'text-emerald-700'
    : tone === 'amber' ? 'text-amber-700'
    : tone === 'red'   ? 'text-rose-700'
    : tone === 'gray'  ? 'text-brand-700'
    : 'text-brand-900';
  return (
    <div>
      <div className={`text-2xl font-serif ${cls}`}>{value}</div>
      <div className="text-xs uppercase tracking-widest text-brand-700">{label}</div>
    </div>
  );
}
