import Link from 'next/link';

export type PaginationProps = {
  total: number;
  page: number;
  pageSize: number;
  /** Current querystring (already includes any filters). page= and pageSize= will be overridden. */
  basePath: string;
  searchParams: URLSearchParams;
  /** Page-size choices for the selector. */
  pageSizeOptions?: number[];
};

function buildHref(basePath: string, sp: URLSearchParams, overrides: Record<string, string | number>) {
  const next = new URLSearchParams(sp.toString());
  for (const [k, v] of Object.entries(overrides)) next.set(k, String(v));
  // Strip empty values so the URL stays clean.
  for (const [k, v] of Array.from(next.entries())) if (!v) next.delete(k);
  const qs = next.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function Pagination({
  total, page, pageSize, basePath, searchParams,
  pageSizeOptions = [50, 100, 200, 500],
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  // Compute a compact page-number window: e.g. 1 … 4 5 [6] 7 8 … 25
  const window = 2;
  const pages = new Set<number | '…'>();
  pages.add(1);
  pages.add(totalPages);
  for (let i = page - window; i <= page + window; i++) {
    if (i > 1 && i < totalPages) pages.add(i);
  }
  const sorted = Array.from(pages).filter(p => p !== '…').sort((a, b) => (a as number) - (b as number)) as number[];
  const final: Array<number | '…'> = [];
  for (let i = 0; i < sorted.length; i++) {
    final.push(sorted[i]!);
    if (i < sorted.length - 1 && sorted[i + 1]! - sorted[i]! > 1) final.push('…');
  }

  const prevHref = page > 1 ? buildHref(basePath, searchParams, { page: page - 1, pageSize }) : '#';
  const nextHref = page < totalPages ? buildHref(basePath, searchParams, { page: page + 1, pageSize }) : '#';

  if (total === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <div className="text-brand-700">
        Showing <b>{from.toLocaleString()}</b>–<b>{to.toLocaleString()}</b> of <b>{total.toLocaleString()}</b>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-brand-700">Per page:</span>
        {pageSizeOptions.map(ps => (
          <Link key={ps}
                href={buildHref(basePath, searchParams, { pageSize: ps, page: 1 })}
                className={`text-xs px-2 py-1 rounded border ${
                  ps === pageSize ? 'border-gold-500 bg-gold-500/10 text-gold-700'
                                  : 'border-brand-100 hover:bg-brand-50 text-brand-700'
                }`}>
            {ps}
          </Link>
        ))}
      </div>

      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={prevHref} className="btn-outline text-xs px-2 py-1">← Prev</Link>
        ) : (
          <span className="text-xs px-2 py-1 text-brand-700/40">← Prev</span>
        )}

        {final.map((p, i) =>
          p === '…' ? (
            <span key={`g${i}`} className="px-1 text-brand-700/40">…</span>
          ) : (
            <Link key={p} href={buildHref(basePath, searchParams, { page: p, pageSize })}
                  className={`text-xs px-2 py-1 rounded ${
                    p === page ? 'bg-brand-900 text-white' : 'hover:bg-brand-50 text-brand-700'
                  }`}>
              {p}
            </Link>
          ),
        )}

        {page < totalPages ? (
          <Link href={nextHref} className="btn-outline text-xs px-2 py-1">Next →</Link>
        ) : (
          <span className="text-xs px-2 py-1 text-brand-700/40">Next →</span>
        )}
      </div>
    </div>
  );
}
