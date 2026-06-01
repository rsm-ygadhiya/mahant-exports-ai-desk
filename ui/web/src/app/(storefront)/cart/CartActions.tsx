'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function CartActions({ diamondIds }: { diamondIds: string[] }) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function send() {
    setBusy(true); setResult(null);
    const res = await fetch('/api/enquiries', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ diamondIds, message }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setResult('Failed to send. Try again.'); return; }
    if (data.whatsappUrl) window.open(data.whatsappUrl, '_blank');
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <textarea className="input min-h-[80px]" placeholder="Add a note for our team (optional)…"
                value={message} onChange={e => setMessage(e.target.value)} />
      <div className="flex gap-3">
        <button onClick={send} disabled={busy || diamondIds.length === 0} className="btn-primary">
          {busy ? 'Sending…' : 'Send Enquiry'}
        </button>
        <a href={`https://wa.me/${process.env.NEXT_PUBLIC_MAHANT_WHATSAPP_NUMBER ?? '919999999999'}`}
           target="_blank" rel="noreferrer" className="btn-outline">
          Open WhatsApp directly
        </a>
      </div>
      {result && <p className="text-sm text-rose-700">{result}</p>}
      <p className="text-xs text-brand-700">
        Sending an enquiry creates a record on our admin panel and opens WhatsApp with a pre-filled message.
      </p>
    </div>
  );
}
