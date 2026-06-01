'use client';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, LineChart, Line, Legend,
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

export function Donut({
  data, height = 220,
}: { data: Array<{ name: string; value: number }>; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={50}
          outerRadius={80}
          paddingAngle={2}
        >
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
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
