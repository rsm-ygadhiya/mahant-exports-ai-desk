import * as XLSX from 'xlsx';
import type { Diamond } from '@prisma/client';

/** Order matters — this is the order columns appear in the exported sheet. */
const COLUMNS: Array<[keyof Diamond | 'measurements_xyz', string]> = [
  ['stoneId', 'Stone ID'],
  ['status', 'Status'],
  ['lab', 'Lab'],
  ['certificateNo', 'Certificate No'],
  ['shape', 'Shape'],
  ['carat', 'Carat'],
  ['color', 'Color'],
  ['clarity', 'Clarity'],
  ['cut', 'Cut'],
  ['polish', 'Polish'],
  ['symmetry', 'Symmetry'],
  ['fluorescence', 'Fluorescence'],
  ['measurements', 'Measurements'],
  ['length', 'Length'],
  ['width', 'Width'],
  ['depth', 'Depth'],
  ['tablePct', 'Table %'],
  ['depthPct', 'Depth %'],
  ['ratio', 'Ratio'],
  ['growthMethod', 'Growth Method'],
  ['growthType', 'Growth Type'],
  ['shade', 'Shade'],
  ['milky', 'Milky'],
  ['eyeClean', 'Eye Clean'],
  ['luster', 'Luster'],
  ['rapPrice', 'Rap Price'],
  ['discountPct', 'Discount %'],
  ['pricePerCarat', 'Price / Carat'],
  ['totalPrice', 'Total Price'],
  ['currency', 'Currency'],
  ['location', 'Location'],
  ['certificateUrl', 'Certificate URL'],
  ['videoUrl', 'Video URL'],
  ['imageUrl', 'Image URL'],
  ['remarks', 'Remarks'],
  ['createdAt', 'Created'],
  ['updatedAt', 'Updated'],
];

/**
 * Build an xlsx file (as a Buffer) from a list of diamonds.
 * Decimals/dates are coerced to plain JS values so Excel renders them correctly.
 */
export function diamondsToXlsx(diamonds: Diamond[], sheetName = 'Stock'): Buffer {
  const rows = diamonds.map(d => {
    const out: Record<string, any> = {};
    for (const [field, label] of COLUMNS) {
      const v = (d as any)[field];
      if (v == null) { out[label] = ''; continue; }
      if (typeof v === 'object' && 'toNumber' in v) out[label] = (v as any).toNumber();
      else if (v instanceof Date) out[label] = v.toISOString().slice(0, 19).replace('T', ' ');
      else out[label] = v;
    }
    return out;
  });

  const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMNS.map(([, label]) => label) });

  // Auto-size columns to ~the widest cell content (capped at 40 chars).
  ws['!cols'] = COLUMNS.map(([, label]) => {
    const maxLen = Math.max(
      label.length,
      ...rows.map(r => String(r[label] ?? '').length),
    );
    return { wch: Math.min(40, Math.max(8, maxLen + 1)) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
