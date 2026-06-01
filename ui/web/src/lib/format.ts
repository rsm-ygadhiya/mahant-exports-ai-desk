/** Coerce a number, numeric string, or Prisma `Decimal` (any object with
 *  toString → numeric string) into a finite number. Returns null if unusable. */
function _toNumber(n: unknown): number | null {
  if (n == null || n === '') return null;
  if (typeof n === 'number') return Number.isFinite(n) ? n : null;
  const v = Number(typeof n === 'string' ? n : (n as { toString(): string }).toString());
  return Number.isFinite(v) ? v : null;
}

export function fmtUsd(n: unknown): string {
  const v = _toNumber(n);
  if (v == null) return '—';
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function fmtCarat(n: unknown): string {
  const v = _toNumber(n);
  if (v == null) return '—';
  return v.toFixed(2);
}

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}
