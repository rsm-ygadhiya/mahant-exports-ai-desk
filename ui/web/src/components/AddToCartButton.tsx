'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AddToCartButton({ diamondId, signedIn, compact = false }: {
  diamondId: string; signedIn: boolean; compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  async function add() {
    if (!signedIn) { router.push('/login'); return; }
    setBusy(true);
    const res = await fetch('/api/cart', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ diamondId }),
    });
    setBusy(false);
    if (res.ok) {
      setAdded(true);
      router.refresh();
      setTimeout(() => setAdded(false), 1500);
    }
  }

  return (
    <button onClick={add} disabled={busy}
            className={compact ? 'text-xs text-gold-600 hover:text-gold-700 underline' : 'btn-gold'}>
      {added ? 'Added ✓' : busy ? '…' : compact ? '+ Cart' : 'Add to cart'}
    </button>
  );
}
