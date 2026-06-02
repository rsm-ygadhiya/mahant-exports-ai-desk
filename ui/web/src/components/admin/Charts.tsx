'use client';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  Cell, LineChart, Line,
} from 'recharts';

// Brand palette — keep all admin charts visually consistent.
export const COLORS = ['#1f2f4d', '#3a5079', '#c19a4b', '#a07f37', '#3a8a6f', '#c54b7e', '#7a4bc5', '#c54b4b'];

export function Card({
  title, subtitle, children, action,
}: { title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-brand-700">{title}</div>
          {subtitle && <div className="text-xs text-brand-700/70 mt-0.5">{subtitle}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function StatusBar({ data }: { data: Array<{ name: string; value: number; fill?: string }> }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e7ecf5" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip cursor={{ fill: '#f5f7fb' }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={d.fill ?? COLORS[i % COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Ranked horizontal-bar chart for category-share data — drop-in replacement
 * for the old Donut. Each row shows the category name, a filled bar sized
 * by its share of the total, the raw count, and a percentage. Better than
 * a pie for reading exact values and ranking, and accessible on small
 * screens where slice angles get unreadable.
 *
 * Export name stays `Donut` so existing callers don't need to change their
 * imports — the chart shape just isn't round anymore.
 */
export function Donut({
  data, height = 220,
}: { data: Array<{ name: string; value: number }>; height?: number }) {
  const total = data.reduce((sum, d) => sum + (d.value || 0), 0) || 1;
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const max = sorted[0]?.value || 1;

  return (
    <div style={{ height }} className="overflow-y-auto pr-1">
      <ul className="space-y-2">
        {sorted.map((d, i) => {
          const pct = (d.value / total) * 100;
          const widthPct = (d.value / max) * 100;
          return (
            <li key={d.name} className="flex items-center gap-2 text-xs">
              <div className="w-24 shrink-0 truncate text-brand-900" title={d.name}>{d.name}</div>
              <div className="flex-1 h-5 rounded bg-brand-50 relative overflow-hidden">
                <div
                  className="h-full rounded transition-[width] duration-500"
                  style={{ width: `${widthPct}%`, backgroundColor: COLORS[i % COLORS.length] }}
                />
                <div className="absolute inset-0 flex items-center px-2 text-[10px] font-mono text-brand-900/80 mix-blend-multiply">
                  {pct.toFixed(1)}%
                </div>
              </div>
              <div className="w-12 shrink-0 text-right font-mono text-brand-900">{d.value.toLocaleString()}</div>
            </li>
          );
        })}
        {sorted.length === 0 && (
          <li className="text-xs text-brand-500 italic px-2">No data yet.</li>
        )}
      </ul>
    </div>
  );
}

/**
 * Calendar-style heatmap: each cell = one bucket, color intensity = value.
 * Useful for things like "enquiries by day of week × hour", "stock age
 * distribution", etc. Pass a 2D array of {label, value} rows.
 */
export function Heatmap({
  rows, height = 220,
}: {
  rows: Array<{ label: string; cells: Array<{ key: string; value: number }> }>;
  height?: number;
}) {
  const allValues = rows.flatMap(r => r.cells.map(c => c.value));
  const max = Math.max(1, ...allValues);
  const colorFor = (v: number) => {
    if (v <= 0) return '#f5f7fb';
    const t = Math.min(1, v / max);
    // Interpolate brand-50 → brand-900 in HSL space (ish).
    const r = Math.round(245 - 215 * t);
    const g = Math.round(247 - 200 * t);
    const b = Math.round(251 - 170 * t);
    return `rgb(${r},${g},${b})`;
  };
  return (
    <div style={{ height }} className="overflow-auto">
      <table className="w-full border-separate" style={{ borderSpacing: 2 }}>
        <tbody>
          {rows.map(row => (
            <tr key={row.label}>
              <td className="text-[10px] text-brand-700 pr-2 align-middle whitespace-nowrap">{row.label}</td>
              {row.cells.map(cell => (
                <td
                  key={cell.key}
                  title={`${row.label} · ${cell.key}: ${cell.value}`}
                  style={{ backgroundColor: colorFor(cell.value) }}
                  className="h-6 rounded text-center text-[10px] font-mono text-brand-900/70"
                >
                  {cell.value > 0 ? cell.value : ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TrendLine({
  data, dataKeys = ['value'],
}: { data: Array<Record<string, any>>; dataKeys?: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e7ecf5" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        {dataKeys.map((k, i) => (
          <Line key={k} type="monotone" dataKey={k} stroke={COLORS[i]} strokeWidth={2} dot={{ r: 2 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
