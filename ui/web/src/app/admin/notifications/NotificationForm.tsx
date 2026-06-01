'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function NotificationForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'all' | 'approved'>('approved');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const res = await fetch('/api/admin/notifications', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, body, audience }),
    });
    setBusy(false);
    if (!res.ok) { setMsg('Failed'); return; }
    setMsg('Queued — will fan out to FCM in production.');
    setTitle(''); setBody('');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="card p-6 space-y-3">
      <input className="input" required placeholder="Title (e.g. New 2ct VS1 stones)"
             value={title} onChange={e => setTitle(e.target.value)} />
      <textarea className="input min-h-[80px]" required placeholder="Body"
                value={body} onChange={e => setBody(e.target.value)} />
      <select className="input max-w-xs" value={audience} onChange={e => setAudience(e.target.value as any)}>
        <option value="approved">Approved buyers only</option>
        <option value="all">All users</option>
      </select>
      <div className="flex gap-3 items-center">
        <button className="btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send notification'}</button>
        {msg && <span className="text-sm text-emerald-700">{msg}</span>}
      </div>
    </form>
  );
}
