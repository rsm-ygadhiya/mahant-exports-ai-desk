import * as XLSX from 'xlsx';
import { prisma } from './db';
import type { Prisma } from '@prisma/client';

function norm(s: string) {
  return s.toLowerCase().replace(/[\s_/-]+/g, '');
}

const FIELD_MAP: Record<string, string> = {
  stoneid: 'stoneId',
  shape: 'shape',
  carat: 'carat', weight: 'carat',
  color: 'color',
  clarity: 'clarity',
  cut: 'cut',
  polish: 'polish',
  symmetry: 'symmetry', sym: 'symmetry',
  fluorescence: 'fluorescence', flo: 'fluorescence', fluo: 'fluorescence', fl: 'fluorescence',
  lab: 'lab',
  certificateno: 'certificateNo', certno: 'certificateNo', reportno: 'certificateNo',
  certificateurl: 'certificateUrl', certurl: 'certificateUrl', certlink: 'certificateUrl',
  videourl: 'videoUrl', videolink: 'videoUrl', video: 'videoUrl',
  imageurl: 'imageUrl', image: 'imageUrl',
  measurements: 'measurements', measurement: 'measurements',
  length: 'length', width: 'width', depth: 'depth',
  tablepct: 'tablePct', table: 'tablePct',
  depthpct: 'depthPct',
  ratio: 'ratio',
  growthmethod: 'growthMethod', type: 'growthMethod',
  growthtype: 'growthType',
  shade: 'shade', milky: 'milky', eyeclean: 'eyeClean', luster: 'luster',
  rapprice: 'rapPrice', rap: 'rapPrice',
  discountpct: 'discountPct', discountspct: 'discountPct', disc: 'discountPct', discount: 'discountPct',
  pricepercarat: 'pricePerCarat', ppc: 'pricePerCarat',
  totalprice: 'totalPrice', amount: 'totalPrice', ppcs: 'totalPrice', ppieces: 'totalPrice',
  currency: 'currency',
  location: 'location',
  status: 'status',
  remarks: 'remarks', comments: 'remarks', inscri: 'remarks', inscription: 'remarks',
};

const NUMERIC = new Set([
  'carat', 'length', 'width', 'depth', 'tablePct', 'depthPct', 'ratio',
  'rapPrice', 'discountPct', 'pricePerCarat', 'totalPrice',
]);

const STATUS_MAP: Record<string, 'AVAILABLE' | 'HOLD' | 'SOLD' | 'NOT_LIVE'> = {
  notlive: 'NOT_LIVE',
  pending: 'NOT_LIVE',
  draft: 'NOT_LIVE',
  available: 'AVAILABLE', a: 'AVAILABLE',
  hold: 'HOLD', h: 'HOLD', memo: 'HOLD',
  sold: 'SOLD', s: 'SOLD',
};

const GROWTH_MAP: Record<string, 'CVD' | 'HPHT' | 'UNKNOWN'> = {
  cvd: 'CVD', hpht: 'HPHT',
};

export type ImportMode = 'add' | 'edit';

export type ImportSummary = {
  mode: ImportMode;
  rowsTotal: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowsFailed: number;
  errors: Array<{ row: number; error: string }>;
};

/**
 * Two import modes:
 *   - 'add'  : create only — if a stone_id already exists, skip it (counted as skipped, not failed)
 *   - 'edit' : upsert — update existing rows, create new ones
 *
 * Neither mode deletes rows that aren't in the file. To clear inventory, delete via the admin UI.
 */
export async function importDiamondsFromBuffer(
  buffer: Buffer,
  adminId: string,
  filename: string,
  mode: ImportMode = 'edit',
): Promise<ImportSummary> {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('Workbook has no sheets');
  const sheet = wb.Sheets[sheetName]!;
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: null });

  // ── Phase 1: parse & validate every row in memory (no DB calls). ──
  type Parsed = { ok: true; rowNum: number; data: Record<string, any> }
              | { ok: false; rowNum: number; error: string };
  const parsed: Parsed[] = rows.map((row, idx): Parsed => {
    const rowNum = idx + 2;
    try {
      const data: Record<string, any> = {};
      for (const [rawKey, rawVal] of Object.entries(row)) {
        const field = FIELD_MAP[norm(rawKey)];
        if (!field) continue;
        if (rawVal === null || rawVal === '') continue;
        let val: any = rawVal;
        if (NUMERIC.has(field)) {
          const n = Number(String(val).replace(/[, $]/g, ''));
          if (Number.isNaN(n)) continue;
          val = n;
        }
        if (field === 'status') {
          // If the value isn't a recognised status, leave it unset so the
          // "new stones default to NOT_LIVE" rule kicks in for new imports.
          const mapped = STATUS_MAP[String(val).toLowerCase().replace(/[\s_-]+/g, '')];
          if (!mapped) continue;
          val = mapped;
        }
        if (field === 'growthMethod') val = GROWTH_MAP[String(val).toLowerCase()] ?? 'UNKNOWN';
        data[field] = val;
      }
      if (!data.stoneId) throw new Error('missing stone_id');
      if (!data.shape || !data.color || !data.clarity || data.carat == null
          || data.pricePerCarat == null || data.totalPrice == null) {
        throw new Error('missing required field (shape/color/clarity/carat/ppc/total)');
      }
      return { ok: true, rowNum, data };
    } catch (err: any) {
      return { ok: false, rowNum, error: err?.message ?? String(err) };
    }
  });

  let created = 0, updated = 0, skipped = 0, failed = 0;
  const errors: Array<{ row: number; error: string }> = [];

  for (const p of parsed) {
    if (!p.ok) { failed++; errors.push({ row: p.rowNum, error: p.error }); }
  }

  // De-dupe within the file by stoneId — keep the LAST occurrence (closer to
  // user's intent if the spreadsheet has corrections lower down).
  const validById = new Map<string, Record<string, any>>();
  for (const p of parsed) if (p.ok) validById.set(p.data.stoneId, p.data);
  const validData = Array.from(validById.values());
  const validIds = Array.from(validById.keys());

  // ── Phase 2: ONE round-trip to find which IDs already exist. ──
  const existing = validIds.length
    ? await prisma.diamond.findMany({
        where: { stoneId: { in: validIds } },
        select: { stoneId: true },
      })
    : [];
  const existingIds = new Set(existing.map(d => d.stoneId));

  // ── Phase 3: split into create vs update vs skip. ──
  // Per spec §3.3: new stock defaults to NOT_LIVE so it stays hidden from
  // buyers until an authorised admin reviews the suggested price and flips
  // it to Live. If the source file explicitly carries a status column, that
  // value still wins (lets you migrate already-live inventory wholesale).
  const toCreate: Record<string, any>[] = [];
  const toUpdate: Record<string, any>[] = [];
  for (const data of validData) {
    if (existingIds.has(data.stoneId)) {
      if (mode === 'add') {
        skipped++;
      } else {
        toUpdate.push(data);
      }
    } else {
      // New stone — if the import didn't carry a status, hold it as NOT_LIVE.
      if (data.status == null) data.status = 'NOT_LIVE';
      toCreate.push(data);
    }
  }

  // ── Phase 4: bulk insert new rows in ONE statement. ──
  if (toCreate.length) {
    try {
      const result = await prisma.diamond.createMany({
        data: toCreate as Prisma.DiamondCreateManyInput[],
        skipDuplicates: true,
      });
      created = result.count;
    } catch (err: any) {
      // If the bulk insert fails, fall back to per-row creates so we can
      // pinpoint the offending rows for the error report.
      for (const data of toCreate) {
        try {
          await prisma.diamond.create({ data: data as Prisma.DiamondCreateInput });
          created++;
        } catch (e: any) {
          failed++;
          errors.push({ row: -1, error: `create ${data.stoneId}: ${e?.message ?? String(e)}` });
        }
      }
    }
  }

  // ── Phase 5: parallelize updates in throttled chunks. ──
  // Neon's pooled connection handles ~20 concurrent statements comfortably.
  // 1000 rows → 50 batches → ~5–10 seconds total.
  const CONCURRENCY = 20;
  for (let i = 0; i < toUpdate.length; i += CONCURRENCY) {
    const chunk = toUpdate.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(chunk.map(d =>
      prisma.diamond.update({ where: { stoneId: d.stoneId }, data: d }),
    ));
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === 'fulfilled') updated++;
      else {
        failed++;
        errors.push({ row: -1, error: `update ${chunk[j].stoneId}: ${r.reason?.message ?? r.reason}` });
      }
    }
  }

  await prisma.stockUpload.create({
    data: {
      filename: `[${mode}] ${filename}`,
      rowsTotal: rows.length,
      rowsCreated: created,
      rowsUpdated: updated,
      rowsFailed: failed,
      errorsJson: errors.length ? errors : undefined,
      uploadedBy: adminId,
    },
  });

  return {
    mode,
    rowsTotal: rows.length,
    rowsCreated: created,
    rowsUpdated: updated,
    rowsSkipped: skipped,
    rowsFailed: failed,
    errors,
  };
}
