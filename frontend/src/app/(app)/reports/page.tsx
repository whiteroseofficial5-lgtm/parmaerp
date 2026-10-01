'use client';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Empty, PageHeader, Panel, Spinner } from '@/components/ui/misc';
import { api, openFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtNum } from '@/lib/utils';

const CATALOG: [string, string, string][] = [
  ['inventory', 'Inventory report', 'Usable, quarantined and valued stock per material'], ['stock-ledger', 'Stock ledger', 'Every movement with running balance'],
  ['consumption', 'Consumption report', 'Raw materials consumed per batch and lot'], ['production', 'Production report', 'Batches, yields and QC outcome'], ['batches', 'Batch report', 'Batch register'],
  ['cost', 'Cost report', 'Material cost and cost per unit by batch'], ['expiry', 'Expiry report', 'Expired and near-expiry stock'], ['suppliers', 'Supplier report', 'Delivery, quality and price performance'], ['audit', 'Audit report', 'Who changed what, before and after'],
];

export default function Reports() {
  const { can } = useAuth();
  const [name, setName] = React.useState('inventory'); const [from, setFrom] = React.useState(''); const [to, setTo] = React.useState('');
  const q = { from, to };
  const { data, isFetching } = useQuery({ queryKey: ['report', name, from, to], queryFn: () => api<any>(`/reports/${name}`, { query: q }) });
  const exp = (format: string) => openFile(`/reports/${name}`, { query: { ...q, format }, download: `${name}.${format}` }).catch((e) => toast.error(e.message));
  const items = CATALOG.filter(([k]) => k !== 'audit' || can('audit:read'));
  return (
    <>
      <PageHeader title="Reports" description="Preview on screen, then export to Excel, CSV or PDF." />
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <nav className="rounded-lg border bg-card p-1.5" aria-label="Reports">{items.map(([k, t, d]) => <button key={k} onClick={() => setName(k)} className={`w-full rounded px-3 py-2 text-left ${name === k ? 'bg-tint' : 'hover:bg-muted'}`}><div className={`text-sm font-medium ${name === k ? 'text-primary' : ''}`}>{t}</div><div className="text-xs text-muted-foreground">{d}</div></button>)}</nav>
        <div className="min-w-0">
          <Panel className="mb-4"><div className="flex flex-wrap items-end gap-3"><div><Label htmlFor="f">From</Label><Input id="f" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div><div><Label htmlFor="t">To</Label><Input id="t" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
            {can('report:export') && <div className="ml-auto flex gap-2"><Button variant="outline" onClick={() => exp('xlsx')}><FileSpreadsheet className="h-4 w-4" />Excel</Button><Button variant="outline" onClick={() => exp('csv')}><Download className="h-4 w-4" />CSV</Button><Button variant="outline" onClick={() => exp('pdf')}><FileText className="h-4 w-4" />PDF</Button></div>}</div></Panel>
          <Panel title={<span className="inline-flex items-center gap-2">{data?.title ?? 'Report'} {isFetching && <Spinner />}</span>} flush>
            {data?.rows?.length ? <div className="max-h-[60vh] overflow-auto"><table className="w-full text-sm"><thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground"><tr>{data.columns.map((c: any) => <th key={c.key} className="whitespace-nowrap px-3 py-2 font-semibold">{c.label}</th>)}</tr></thead><tbody>{data.rows.slice(0, 500).map((r: any, i: number) => <tr key={i} className="border-t">{data.columns.map((c: any) => <td key={c.key} className={`whitespace-nowrap px-3 py-1.5 ${typeof r[c.key] === 'number' ? 'num text-right' : ''}`}>{typeof r[c.key] === 'number' ? fmtNum(r[c.key], 3) : String(r[c.key] ?? '')}</td>)}</tr>)}</tbody></table></div> : <Empty title="No data for these filters" />}
            {data?.rows?.length > 500 && <p className="border-t px-3 py-2 text-xs text-muted-foreground">Showing first 500 of {data.rows.length} rows — export for the full set.</p>}
          </Panel>
        </div>
      </div>
    </>
  );
}
