import type { Prisma } from '@prisma/client';

const csv = (v?: string | null) => v?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
const num = (v?: string | null) => (v == null || v === '' ? undefined : Number(v));

/** Split a free-form list (commas, whitespace, newlines, semicolons) into clean tokens. */
const splitIds = (v?: string | null): string[] =>
  v ? Array.from(new Set(v.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean))) : [];

export type DiamondQuery = ReturnType<typeof parseDiamondQuery>;

export function parseDiamondQuery(sp: URLSearchParams) {
  return {
    shape: csv(sp.get('shape')),
    color: csv(sp.get('color')),
    clarity: csv(sp.get('clarity')),
    cut: csv(sp.get('cut')),
    polish: csv(sp.get('polish')),
    symmetry: csv(sp.get('symmetry')),
    fluorescence: csv(sp.get('fluorescence')),
    lab: csv(sp.get('lab')),
    growth: csv(sp.get('growth')),
    statusList: csv(sp.get('status')),
    stoneIds: splitIds(sp.get('stone_ids')),
    cert_no: sp.get('cert_no') ?? '',
    location: sp.get('location') ?? '',
    carat_min: num(sp.get('carat_min')),
    carat_max: num(sp.get('carat_max')),
    ppc_min: num(sp.get('ppc_min')),
    ppc_max: num(sp.get('ppc_max')),
    total_min: num(sp.get('total_min')),
    total_max: num(sp.get('total_max')),
    sort: (sp.get('sort') ?? 'new') as 'ppc_asc' | 'ppc_desc' | 'carat_asc' | 'carat_desc' | 'new' | 'best_deal',
    page: Math.max(1, Number(sp.get('page')) || 1),
    pageSize: Math.min(500, Math.max(10, Number(sp.get('pageSize')) || 50)),
  };
}

export function buildDiamondWhere(q: DiamondQuery, opts: { adminMode?: boolean } = {}): Prisma.DiamondWhereInput {
  const w: Prisma.DiamondWhereInput = {};

  // Customers (non-admin) can never see NOT_LIVE stones. Strip the value out
  // even if it was passed in the URL.
  const buyerSafeStatuses = opts.adminMode
    ? q.statusList
    : q.statusList.filter(s => s !== 'NOT_LIVE');

  if (buyerSafeStatuses.length) w.status = { in: buyerSafeStatuses as any };
  else if (!opts.adminMode) w.status = 'AVAILABLE'; // default for buyers
  // Admin in admin mode with no status filter = show everything including NOT_LIVE.

  if (q.shape.length) w.shape = { in: q.shape };
  if (q.color.length) w.color = { in: q.color };
  if (q.clarity.length) w.clarity = { in: q.clarity };
  if (q.cut.length) w.cut = { in: q.cut };
  if (q.polish.length) w.polish = { in: q.polish };
  if (q.symmetry.length) w.symmetry = { in: q.symmetry };
  if (q.fluorescence.length) w.fluorescence = { in: q.fluorescence };
  if (q.lab.length) w.lab = { in: q.lab };
  if (q.growth.length) w.growthMethod = { in: q.growth as any };
  if (q.cert_no) w.certificateNo = { contains: q.cert_no, mode: 'insensitive' };
  if (q.location) w.location = { contains: q.location, mode: 'insensitive' };
  // Stone-ID search: 1 token → substring match (handy for "00001" type lookups);
  // multiple tokens → exact IN list (paste a list of full IDs).
  if (q.stoneIds.length === 1) {
    w.stoneId = { contains: q.stoneIds[0], mode: 'insensitive' };
  } else if (q.stoneIds.length > 1) {
    w.stoneId = { in: q.stoneIds };
  }

  const range = (a?: number, b?: number) =>
    a == null && b == null ? undefined : { ...(a != null && { gte: a }), ...(b != null && { lte: b }) };

  const c = range(q.carat_min, q.carat_max); if (c) w.carat = c as any;
  const p = range(q.ppc_min, q.ppc_max);     if (p) w.pricePerCarat = p as any;
  const t = range(q.total_min, q.total_max); if (t) w.totalPrice = t as any;

  return w;
}

export function buildDiamondOrderBy(sort: DiamondQuery['sort']): Prisma.DiamondOrderByWithRelationInput {
  switch (sort) {
    case 'ppc_asc': return { pricePerCarat: 'asc' };
    case 'ppc_desc': return { pricePerCarat: 'desc' };
    case 'carat_asc': return { carat: 'asc' };
    case 'carat_desc': return { carat: 'desc' };
    case 'best_deal': return { discountPct: 'asc' };
    case 'new':
    default: return { createdAt: 'desc' };
  }
}
