// Rap rate sheet importer — supports two formats:
//
// 1. **RapNet CSV** (headerless, the format Rapaport actually distributes):
//      shape_code,clarity,color,carat_min,carat_max,rate_per_ct,sheet_date
//    Example:  BR,IF,D,0.01,0.03,760.0, 4/24/2026
//    Shape codes follow Rapaport convention (BR=Round, PS=Pear, EM=Emerald, …).
//    `sheetDate` is taken from the file itself.
//
// 2. **Long format with header** (manual sheets):
//      shape, color, clarity, carat_min, carat_max, rate_per_ct
//    Aliases tolerated for each column.
//
// Detection is automatic: we sniff the first row to decide which format
// applies. Re-uploading the same `(sheetDate, shape, color, clarity,
// caratMin, caratMax)` updates the rate.

import * as XLSX from 'xlsx';
import { prisma } from '@/lib/db';

const norm = (s: string) => s.toLowerCase().replace(/[\s_/-]+/g, '');

// Map Rapaport's 2-letter codes → our internal shape names. Keep these in
// sync with the shape values used in the diamond inventory (case-sensitive).
const RAP_SHAPE_CODES: Record<string, string> = {
  BR: 'Round',
  PS: 'Pear',
  EM: 'Emerald',
  PR: 'Princess',
  OV: 'Oval',
  MQ: 'Marquise',
  HS: 'Heart',
  CU: 'Cushion',
  RA: 'Radiant',
  AS: 'Asscher',
  RD: 'Round',         // alt
  HT: 'Heart',         // alt
};

const FIELD_MAP: Record<string, string> = {
  shape: 'shape',
  color: 'color', colour: 'color',
  clarity: 'clarity',
  caratmin: 'caratMin', minct: 'caratMin', min: 'caratMin', from: 'caratMin', fromct: 'caratMin',
  caratmax: 'caratMax', maxct: 'caratMax', max: 'caratMax', to: 'caratMax', toct: 'caratMax',
  rateperct: 'ratePerCt', rate: 'ratePerCt', rap: 'ratePerCt', raprate: 'ratePerCt',
  rapprice: 'ratePerCt', priceperct: 'ratePerCt', ppc: 'ratePerCt',
};

function isRapnetRow(cells: any[]): boolean {
  // RapNet format: first cell is a known shape code, exactly 7 columns
  // (shape, clarity, color, carat_min, carat_max, rate, date).
  if (cells.length < 6) return false;
  const first = String(cells[0] ?? '').trim().toUpperCase();
  return !!RAP_SHAPE_CODES[first];
}

function parseDate(s: any, fallback: Date): Date {
  if (s == null) return fallback;
  if (s instanceof Date) return s;
  // xlsx serial date?
  if (typeof s === 'number' && s > 25_000) {
    const d = XLSX.SSF.parse_date_code(s);
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d));
  }
  const str = String(s).trim();
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export type RapImportSummary = {
  filename: string;
  rowsTotal: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsFailed: number;
  errors: Array<{ row: number; error: string }>;
};

export async function importRapSheetFromBuffer(
  buffer: Buffer,
  filename: string,
  fallbackSheetDate: Date,
  adminId: string,
): Promise<RapImportSummary> {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]!];
  if (!sheet) throw new Error('No sheet found in workbook');

  // Read as 2D array so we can sniff for header vs headerless RapNet format.
  const aoa = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null });
  const dataRows: any[][] = aoa.filter(r => Array.isArray(r) && r.some(c => c != null && c !== ''));
  if (dataRows.length === 0) throw new Error('Sheet is empty');

  const useRapnet = isRapnetRow(dataRows[0]!);
  const rows: Array<Record<string, any>> = [];

  if (useRapnet) {
    // RapNet: shape_code, clarity, color, carat_min, carat_max, rate, date
    for (const r of dataRows) {
      rows.push({
        shapeCode: r[0], clarity: r[1], color: r[2],
        caratMin: r[3], caratMax: r[4], ratePerCt: r[5],
        sheetDate: r[6],
      });
    }
  } else {
    // Header format: first row is headers.
    const headers = (dataRows[0] ?? []).map((h: any) => String(h ?? ''));
    for (let i = 1; i < dataRows.length; i++) {
      const r = dataRows[i]!;
      const obj: Record<string, any> = {};
      for (let j = 0; j < headers.length; j++) obj[headers[j]!] = r[j];
      rows.push(obj);
    }
  }

  let inserted = 0, updated = 0, failed = 0;
  const errors: Array<{ row: number; error: string }> = [];

  // ── Phase 1: parse all rows in memory.
  type Parsed = { shape: string; color: string; clarity: string;
                  caratMin: number; caratMax: number; ratePerCt: number;
                  sheetDate: Date };
  const parsed: Parsed[] = [];
  rows.forEach((row, idx) => {
    try {
      let shape: string | undefined, color: string | undefined, clarity: string | undefined;
      let caratMin: number | undefined, caratMax: number | undefined, ratePerCt: number | undefined;
      let rowSheetDate = fallbackSheetDate;

      if (useRapnet) {
        const code = String(row.shapeCode ?? '').trim().toUpperCase();
        shape = RAP_SHAPE_CODES[code];
        if (!shape) throw new Error(`unknown shape code "${code}"`);
        color   = String(row.color   ?? '').trim().toUpperCase();
        clarity = String(row.clarity ?? '').trim().toUpperCase();
        caratMin  = Number(String(row.caratMin  ?? '').replace(/[, $]/g, ''));
        caratMax  = Number(String(row.caratMax  ?? '').replace(/[, $]/g, ''));
        ratePerCt = Number(String(row.ratePerCt ?? '').replace(/[, $]/g, ''));
        rowSheetDate = parseDate(row.sheetDate, fallbackSheetDate);
      } else {
        const data: Record<string, any> = {};
        for (const [k, v] of Object.entries(row)) {
          const f = FIELD_MAP[norm(k)];
          if (!f) continue;
          if (v === null || v === '') continue;
          data[f] = v;
        }
        shape   = data.shape ? String(data.shape).trim() : undefined;
        color   = data.color ? String(data.color).trim().toUpperCase() : undefined;
        clarity = data.clarity ? String(data.clarity).trim().toUpperCase() : undefined;
        const num = (x: any) => Number(String(x).replace(/[, $]/g, ''));
        if (data.caratMin != null)  caratMin  = num(data.caratMin);
        if (data.caratMax != null)  caratMax  = num(data.caratMax);
        if (data.ratePerCt != null) ratePerCt = num(data.ratePerCt);
      }

      if (!shape || !color || !clarity) throw new Error('missing shape/color/clarity');
      if (caratMin == null || caratMax == null) throw new Error('missing carat_min / carat_max');
      if (ratePerCt == null) throw new Error('missing rate_per_ct');
      if ([caratMin, caratMax, ratePerCt].some(n => Number.isNaN(n))) {
        throw new Error('non-numeric carat or rate');
      }
      if (caratMax <= caratMin) throw new Error('carat_max must be > carat_min');

      parsed.push({ shape, color, clarity, caratMin, caratMax, ratePerCt, sheetDate: rowSheetDate });
    } catch (e: any) {
      failed++;
      errors.push({ row: idx + (useRapnet ? 1 : 2), error: e?.message ?? String(e) });
    }
  });

  // ── Phase 2: bulk-upsert.
  // Strategy: do all updates first (so we know exactly which tuples existed),
  // then createMany skipDuplicates for the rest. Updates are parallel-throttled.

  const CONCURRENCY = 25;
  let actuallyUpdated = 0;
  for (let i = 0; i < parsed.length; i += CONCURRENCY) {
    const chunk = parsed.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(chunk.map(p =>
      prisma.rapRate.updateMany({
        where: {
          sheetDate: p.sheetDate, shape: p.shape, color: p.color, clarity: p.clarity,
          caratMin: p.caratMin as any, caratMax: p.caratMax as any,
        },
        data: { ratePerCt: p.ratePerCt as any, filename, uploadedBy: adminId, uploadedAt: new Date() },
      }),
    ));
    for (const r of results) if (r.status === 'fulfilled') actuallyUpdated += r.value.count;
  }
  updated = actuallyUpdated;

  // Insert anything that didn't already exist.
  if (parsed.length > updated) {
    const allData = parsed.map(p => ({
      sheetDate: p.sheetDate, shape: p.shape, color: p.color, clarity: p.clarity,
      caratMin: p.caratMin as any, caratMax: p.caratMax as any,
      ratePerCt: p.ratePerCt as any, filename, uploadedBy: adminId,
    }));
    try {
      const r = await prisma.rapRate.createMany({ data: allData as any, skipDuplicates: true });
      inserted = r.count;
    } catch (e: any) {
      errors.push({ row: -1, error: `bulk insert failed: ${e?.message ?? e}` });
    }
  }

  return {
    filename,
    rowsTotal: rows.length,
    rowsInserted: inserted,
    rowsUpdated: updated,
    rowsFailed: failed,
    errors,
  };
}

/**
 * Look up the Rap rate that matches a stone, using the most recent sheet on or
 * before the given `asOf` date. Returns null if no matching bucket exists.
 */
export async function findRapRate(args: {
  shape: string; color: string; clarity: string; carat: number; asOf?: Date;
}): Promise<{ ratePerCt: number; sheetDate: Date } | null> {
  const matches = await prisma.rapRate.findMany({
    where: {
      shape: args.shape,
      color: args.color.toUpperCase(),
      clarity: args.clarity.toUpperCase(),
      caratMin: { lte: args.carat as any },
      caratMax: { gt: args.carat as any },
      ...(args.asOf ? { sheetDate: { lte: args.asOf } } : {}),
    },
    orderBy: { sheetDate: 'desc' },
    take: 1,
  });
  const m = matches[0];
  if (!m) return null;
  return { ratePerCt: Number(m.ratePerCt), sheetDate: m.sheetDate };
}
