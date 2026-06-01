import Link from 'next/link';
import { fmtUsd } from '@/lib/format';

export function PriceCell({
  price, hidden, signedIn,
}: { price: number | string | null; hidden: boolean; signedIn: boolean }) {
  if (!signedIn) {
    return <Link href="/login" className="text-xs text-gold-600 underline">Sign in to view</Link>;
  }
  if (hidden) {
    return <span className="text-xs text-brand-700">Enquire for price</span>;
  }
  return <span className="font-medium">{fmtUsd(price as any)}</span>;
}
