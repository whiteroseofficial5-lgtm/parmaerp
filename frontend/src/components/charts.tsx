'use client';
import * as React from 'react';
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export const C = {
  primary: 'hsl(var(--primary))', sky: 'hsl(213 80% 68%)', ink: 'hsl(217 45% 30%)', success: 'hsl(var(--success))',
  warning: 'hsl(var(--warning))', danger: 'hsl(var(--danger))', grid: 'hsl(var(--border))', muted: 'hsl(var(--muted-foreground))',
};

const tip = { contentStyle: { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12 }, cursor: { fill: 'hsl(var(--tint))' } };
const axis = { stroke: C.muted, fontSize: 11, tickLine: false, axisLine: false } as const;
const compact = (v: number) => (v >= 1e7 ? `${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(v));

export function BarPair({ data, a, b, aLabel, bLabel, money }: { data: any[]; a: string; b: string; aLabel: string; bLabel: string; money?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ left: -8, right: 4, top: 8 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="month" {...axis} /><YAxis {...axis} tickFormatter={compact} width={48} />
        <Tooltip {...tip} formatter={(v: number) => (money ? `₹${v.toLocaleString('en-IN')}` : v.toLocaleString('en-IN'))} />
        <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey={a} name={aLabel} fill={C.primary} radius={[3, 3, 0, 0]} /><Bar dataKey={b} name={bLabel} fill={C.sky} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CostYield({ data }: { data: { month: string; cost: number; avgYield: number | null }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ left: -8, right: -8, top: 8 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="month" {...axis} />
        <YAxis yAxisId="l" {...axis} tickFormatter={compact} width={48} />
        <YAxis yAxisId="r" orientation="right" domain={[90, 100]} {...axis} tickFormatter={(v) => `${v}%`} width={40} />
        <Tooltip {...tip} />
        <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
        <Bar yAxisId="l" dataKey="cost" name="Material cost (₹)" fill={C.primary} radius={[3, 3, 0, 0]} />
        <Line yAxisId="r" dataKey="avgYield" name="Avg yield %" stroke={C.warning} strokeWidth={2} dot={{ r: 3 }} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function HBars({ data, x, y, color = C.primary, unit = '' }: { data: any[]; x: string; y: string; color?: string; unit?: string }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 34)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
        <CartesianGrid stroke={C.grid} horizontal={false} />
        <XAxis type="number" {...axis} tickFormatter={compact} /><YAxis type="category" dataKey={y} {...axis} width={130} />
        <Tooltip {...tip} formatter={(v: number) => `${v.toLocaleString('en-IN')}${unit}`} />
        <Bar dataKey={x} fill={color} radius={[0, 3, 3, 0]} barSize={16} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** History (solid) + forecast (dashed) + confidence range for one material. */
export function ForecastChart({ history, forecast, uom }: { history: { month: string; qty: number }[]; forecast: { month: string; qty: number; low: number; high: number }[]; uom: string }) {
  const data = [...history.map((h) => ({ month: h.month, actual: h.qty })), ...forecast.map((f, i) => ({ month: f.month, forecast: f.qty, low: f.low, high: f.high, ...(i === 0 ? { actual: history[history.length - 1]?.qty } : {}) }))];
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ left: -8, right: 8, top: 8 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="month" {...axis} /><YAxis {...axis} tickFormatter={compact} width={48} />
        <Tooltip {...tip} formatter={(v: number) => `${v.toLocaleString('en-IN')} ${uom}`} />
        <Legend iconType="line" wrapperStyle={{ fontSize: 12 }} />
        <Line dataKey="actual" name="Consumption" stroke={C.primary} strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
        <Line dataKey="forecast" name="Forecast" stroke={C.warning} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} />
        <Line dataKey="high" name="Upper (80%)" stroke={C.muted} strokeWidth={1} strokeDasharray="2 3" dot={false} />
        <Line dataKey="low" name="Lower (80%)" stroke={C.muted} strokeWidth={1} strokeDasharray="2 3" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
