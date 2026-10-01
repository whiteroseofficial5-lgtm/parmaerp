'use client';
import { useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { DataTable } from '@/components/data-table';
import { FormDialog, useAction } from '@/components/form-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Empty, PageHeader, Panel } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtNum, humanize } from '@/lib/utils';

const DAYS = 21;
export default function Production() {
  const { can } = useAuth(); const router = useRouter(); const act = useAction();
  const [wo, setWo] = React.useState(false); const [plan, setPlan] = React.useState(false);
  const cols: ColumnDef<any>[] = [
    { header: 'Work order', accessorKey: 'woNumber', cell: (c) => <span className="id-text font-medium">{c.getValue() as string}</span> },
    { header: 'Product', id: 'p', accessorFn: (r) => r.product.name },
    { header: 'Quantity', accessorFn: (r) => Number(r.quantity), cell: (c) => <span className="num">{fmtNum(c.getValue(), 0)}</span> },
    { header: 'Window', id: 'w', accessorFn: (r) => r.plannedStart, cell: ({ row: { original: r } }) => <span className="num text-muted-foreground">{fmtDate(r.plannedStart)} → {fmtDate(r.plannedEnd)}</span> },
    { header: 'Shift / line', id: 's', accessorFn: (r) => r.shift?.name ?? '', cell: ({ row: { original: r } }) => <span className="text-muted-foreground">{[r.shift?.name, r.lineName].filter(Boolean).join(' · ') || '—'}</span> },
    { header: 'Operators', id: 'o', accessorFn: (r) => r.operators.length, cell: ({ row: { original: r } }) => <span className="text-[0.8125rem]">{r.operators.map((o: any) => o.user.name).join(', ') || '—'}</span> },
    { header: 'Progress', accessorKey: 'progressPct', cell: (c) => <div className="flex items-center gap-2"><div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${c.getValue()}%` }} /></div><span className="num text-xs">{c.getValue() as number}%</span></div> },
    { header: 'Status', accessorKey: 'status', cell: (c) => <StatusBadge status={c.getValue() as string} /> },
    { header: 'Batch', id: 'b', enableSorting: false, cell: ({ row: { original: r } }) => r.batch ? <button className="id-text text-primary hover:underline" onClick={() => router.push(`/batches/${r.batch.id}`)}>{r.batch.batchNumber}</button> : can('batch:create') && r.status !== 'CANCELLED' ? <Button size="sm" variant="subtle" onClick={() => act(async () => { const b = await api<any>(`/production/work-orders/${r.id}/create-batch`, { method: 'POST' }); router.push(`/batches/${b.id}`); })}>Create batch</Button> : '—' },
  ];
  return (
    <>
      <PageHeader title="Production management" description="Plans, work orders, shifts and operator assignment." actions={can('production:create') && <><Button variant="outline" onClick={() => setPlan(true)}>New plan</Button><Button onClick={() => setWo(true)}><Plus className="h-4 w-4" />New work order</Button></>} />
      <Tabs defaultValue="schedule">
        <TabsList><TabsTrigger value="schedule">Schedule</TabsTrigger><TabsTrigger value="wo">Work orders</TabsTrigger><TabsTrigger value="plans">Plans</TabsTrigger></TabsList>
        <TabsContent value="schedule"><Gantt /></TabsContent>
        <TabsContent value="wo"><DataTable endpoint="/production/work-orders" columns={cols} search={false} filters={[{ key: 'status', label: 'Status', options: ['PLANNED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((v) => ({ value: v, label: humanize(v) })) }]} /></TabsContent>
        <TabsContent value="plans"><Plans /></TabsContent>
      </Tabs>
      <FormDialog title="New work order" open={wo} onOpenChange={setWo} invalidate={['/production/work-orders', 'schedule']}
        fields={[{ name: 'productId', label: 'Product', type: 'select', required: true, optionsFrom: { endpoint: '/products', label: (r) => `${r.name} ${r.strength ?? ''}` } }, { name: 'quantity', label: 'Quantity', type: 'number', required: true, half: true }, { name: 'priority', label: 'Priority (1 high – 5 low)', type: 'number', half: true, defaultValue: 3 }, { name: 'plannedStart', label: 'Planned start', type: 'date', required: true, half: true }, { name: 'plannedEnd', label: 'Planned end', type: 'date', required: true, half: true }, { name: 'shiftId', label: 'Shift', type: 'select', half: true, optionsFrom: { endpoint: '/shifts', label: (r) => `${r.name} (${r.startTime}–${r.endTime})` } }, { name: 'lineName', label: 'Line', half: true, placeholder: 'Tablet Line 1' }, { name: 'operatorId', label: 'Operator', type: 'select', optionsFrom: { endpoint: '/users/lookup', label: (r) => r.name } }]}
        onSubmit={(v) => { const { operatorId, ...rest } = v; return api('/production/work-orders', { body: { ...rest, operatorIds: operatorId ? [operatorId] : [] } }); }} />
      <FormDialog title="New production plan" open={plan} onOpenChange={setPlan} invalidate={['plans']}
        fields={[{ name: 'periodStart', label: 'Period start', type: 'date', required: true, half: true }, { name: 'periodEnd', label: 'Period end', type: 'date', required: true, half: true }, { name: 'productId', label: 'Product', type: 'select', required: true, optionsFrom: { endpoint: '/products', label: (r) => r.name } }, { name: 'plannedQty', label: 'Planned quantity', type: 'number', required: true, half: true }, { name: 'plannedBatches', label: 'Batches', type: 'number', half: true, defaultValue: 1 }, { name: 'notes', label: 'Notes' }]}
        onSubmit={(v) => api('/production/plans', { body: { periodStart: v.periodStart, periodEnd: v.periodEnd, notes: v.notes, items: [{ productId: v.productId, plannedQty: v.plannedQty, plannedBatches: v.plannedBatches ?? 1 }] } })} />
    </>
  );
}

function Gantt() {
  const from = React.useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 3); d.setHours(0, 0, 0, 0); return d; }, []);
  const to = new Date(from.getTime() + DAYS * 86_400_000);
  const { data } = useQuery({ queryKey: ['schedule'], queryFn: () => api<any[]>('/production/schedule', { query: { from: from.toISOString(), to: to.toISOString() } }) });
  const days = Array.from({ length: DAYS }, (_, i) => new Date(from.getTime() + i * 86_400_000));
  const pos = (d: string) => Math.min(Math.max((new Date(d).getTime() - from.getTime()) / (DAYS * 86_400_000), 0), 1) * 100;
  const today = pos(new Date().toISOString());
  return (
    <Panel flush>
      {!data?.length ? <Empty title="Nothing scheduled in this window" hint="Create a work order to plan production." /> : (
        <div className="overflow-x-auto"><div className="min-w-[760px]">
          <div className="relative grid border-b bg-muted/60 text-[0.6875rem] text-muted-foreground" style={{ gridTemplateColumns: `180px repeat(${DAYS}, 1fr)` }}><div className="px-3 py-2">Work order</div>{days.map((d) => <div key={+d} className={`num py-2 text-center ${[0, 6].includes(d.getDay()) ? 'bg-muted' : ''}`}>{d.getDate()}</div>)}</div>
          {data.map((w) => (
            <div key={w.id} className="relative grid items-center border-b last:border-b-0" style={{ gridTemplateColumns: '180px 1fr' }}>
              <div className="px-3 py-2"><div className="id-text">{w.woNumber}</div><div className="truncate text-xs text-muted-foreground">{w.product.name}</div></div>
              <div className="relative h-9"><div className="absolute inset-y-0" style={{ left: `${today}%` }}><div className="h-full w-px bg-danger/60" /></div>
                <div className="absolute top-2 h-5 overflow-hidden rounded bg-primary/85 px-1.5 text-[0.6875rem] leading-5 text-primary-foreground" style={{ left: `${pos(w.plannedStart)}%`, width: `${Math.max(pos(w.plannedEnd) - pos(w.plannedStart), 2)}%` }} title={`${humanize(w.status)} · ${w.shift?.name ?? ''}`}>{humanize(w.status)}</div></div>
            </div>))}
        </div></div>)}
    </Panel>
  );
}

function Plans() {
  const { data } = useQuery({ queryKey: ['plans'], queryFn: () => api<any[]>('/production/plans') });
  return <Panel flush><table className="w-full text-sm"><thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr>{['Plan', 'Period', 'Products', 'Status'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
    <tbody>{data?.map((p) => <tr key={p.id} className="border-t"><td className="px-3 py-2 id-text">{p.planNumber}</td><td className="px-3 py-2 num text-muted-foreground">{fmtDate(p.periodStart)} → {fmtDate(p.periodEnd)}</td><td className="px-3 py-2">{p.items.map((i: any) => `${i.product.name} × ${fmtNum(i.plannedQty, 0)}`).join(', ')}</td><td className="px-3 py-2"><StatusBadge status={p.status} /></td></tr>)}{!data?.length && <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">No plans yet.</td></tr>}</tbody></table></Panel>;
}
