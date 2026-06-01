'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { DiamondStatus } from '@prisma/client';

// Allowed transitions per current status. NOT_LIVE deliberately has no inline
// transition — going Live happens via the price-approval flow on /admin/pending-stock.
const NEXT: Record<DiamondStatus, DiamondStatus[]> = {
  AVAILABLE: ['HOLD', 'SOLD'],
  HOLD: ['AVAILABLE', 'SOLD'],
  SOLD: ['AVAILABLE'],
  NOT_LIVE: [],
};

const LABEL: Record<DiamondStatus, string> = {
  AVAILABLE: 'Live',
  HOLD: 'On Memo',
  SOLD: 'Sold',
  NOT_LIVE: 'Not Live',
};

export function StatusActions({ diamondId, status }: { diamondId: string; status: DiamondStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(s: DiamondStatus) {
    setBusy(true); setError(null);
    const res = await fetch(`/api/admin/diamonds/${diamondId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: s }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? `Failed (${res.status})`);
      return;
    }
    router.refresh();
  }

  if (status === 'NOT_LIVE') {
    return (
      <Link href="/admin/pending-stock" className="text-xs text-gold-600 hover:underline">
        Review price →
      </Link>
    );
  }

  return (
    <div className="space-y-0.5">
      <div className="flex gap-2 text-xs">
        {NEXT[status].map(s => (
          <button key={s} disabled={busy} onClick={() => setStatus(s)}
                  className="text-brand-700 hover:text-gold-600 underline disabled:opacity-50">
            → {LABEL[s]}
          </button>
        ))}
      </div>
      {error && <div className="text-rose-700 text-[10px]">{error}</div>}
    </div>
  );
}
