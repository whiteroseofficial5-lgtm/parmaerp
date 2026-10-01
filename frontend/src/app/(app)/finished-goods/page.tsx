'use client';
import { ColumnDef } from '@tanstack/react-table';
import { Truck } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { DataTable } from '@/components/data-table';
import { FormDialog } from '@/components/form-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { PageHeader, Panel } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { daysUntil, fmtDate, fmtNum, humanize } from '@/lib/utils';

export default function FinishedGoods() {
  const { can } = useAuth();
  const [dispatch, setDispatch] = React.useState(false);
  const [reserve, setReserve] = React.useState<any>(null);
  const cols: ColumnDef<any>[] = [
    { header: 'Product', id: 'p', accessorFn: (r) => r.product.name, cell: ({ row: { original: r } }) => <span className="font-medium">{r.product.name} <span className="font-normal text-muted-foreground">{r.product.strength}</span></span> },
    { header: 'Batch', id: 'b', accessorFn: (r) => r.batch.batchNumber, cell: ({ row: { original: r } }) => <Link href={`/batches/${r.batchId}`} className="id-text text-primary hover:underline">{r.batch.batchNumber}</Link> },
    { header: 'Mfg', accessorKey: 'mfgDate', cell: (c) => <span className="num">{fmtDate(c.getValue() as string)}</span> },
    { header: 'Expiry', accessorKey: 'expiryDate', cell: ({ row: { original: r } }) => { const d = daysUntil(r.expiryDate); return <span className="num">{fmtDate(r.expiryDate)}{d !== null && d >= 0 && d <= 180 && <span className="ml-1.5 text-xs text-warning">{d} d</span>}</span>; } },
    { header: 'Available', accessorFn: (r) => Number(r.availableQty), cell: (c) => <span className="num font-medium">{fmtNum(c.getValue(), 0)}</span> },
    { header: 'Reserved', accessorFn: (r) => Number(r.reservedQty), cell: (c) => <span className="num text-muted-foreground">{fmtNum(c.getValue(), 0)}</span> },
    { header: 'Location', id: 'l', accessorFn: (r) => `${r.warehouse.name}${r.bin ? ' · ' + r.bin.code : ''}`, cell: (c) => <span className="text-muted-foreground">{c.getValue() as string}</span> },
    { header: 'Status', accessorKey: 'status', cell: (c) => <StatusBadge status={c.getValue() as string} /> },
    { header: '', id: 'a', enableSorting: false, cell: ({ row: { original: r } }) => r.status === 'RELEASED' && can('fg:update') ? <Button size="sm" variant="ghost" onClick={() => setReserve(r)}>Reserve</Button> : null },
  ];
  const dcols: ColumnDef<any>[] = [];
  const { data: disp } = useQuery({ queryKey: ['dispatches'], queryFn: () => api<any[]>('/finished-goods/dispatches/all') });
  return (
    <>
      <PageHeader title="Finished goods" description="Only QC-released, unexpired stock can be dispatched. Every unit traces back to its batch." actions={can('stock:dispatch') && <Button onClick={() => setDispatch(true)}><Truck className="h-4 w-4" />New dispatch</Button>} />
      <Tabs defaultValue="stock">
        <TabsList><TabsTrigger value="stock">Stock by batch</TabsTrigger><TabsTrigger value="disp">Dispatch tracking</TabsTrigger></TabsList>
        <TabsContent value="stock"><DataTable endpoint="/finished-goods" columns={cols} search="Search product or batch…" filters={[{ key: 'status', label: 'Status', options: ['QUARANTINE', 'RELEASED', 'RECALLED', 'EXPIRED', 'DEPLETED'].map((v) => ({ value: v, label: humanize(v) })) }]} /></TabsContent>
        <TabsContent value="disp"><Panel flush><table className="w-full text-sm"><thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr>{['Dispatch', 'Date', 'Customer', 'Items', 'Invoice'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{disp?.map((d) => <tr key={d.id} className="border-t align-top"><td className="px-3 py-2 id-text">{d.dispatchNumber}</td><td className="px-3 py-2 text-muted-foreground">{fmtDate(d.dispatchedAt)}</td><td className="px-3 py-2">{d.customer}<div className="text-xs text-muted-foreground">{d.destination}</div></td><td className="px-3 py-2">{d.items.map((i: any) => <div key={i.id} className="text-[0.8125rem]">{i.fgLot.product.name} · <span className="id-text">{i.fgLot.batch.batchNumber}</span> · <span className="num">{fmtNum(i.quantity, 0)}</span></div>)}</td><td className="px-3 py-2 id-text text-muted-foreground">{d.invoiceRef ?? '—'}</td></tr>)}{!disp?.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No dispatches yet.</td></tr>}</tbody></table></Panel></TabsContent>
      </Tabs>
      <FormDialog title="New dispatch" description="Only released, unexpired batches are selectable." open={dispatch} onOpenChange={setDispatch} invalidate={['/finished-goods', 'dispatches', '/dashboard']}
        fields={[{ name: 'customer', label: 'Customer', required: true }, { name: 'destination', label: 'Destination', half: true }, { name: 'invoiceRef', label: 'Invoice ref', half: true }, { name: 'vehicleNo', label: 'Vehicle no.', half: true }, { name: 'fgLotId', label: 'Batch', type: 'select', required: true, optionsFrom: { endpoint: '/finished-goods', query: { status: 'RELEASED' }, label: (r) => `${r.product.name} · ${r.batch.batchNumber} (${fmtNum(r.availableQty, 0)} avail.)` } }, { name: 'quantity', label: 'Quantity', type: 'number', required: true, half: true }]}
        onSubmit={(v) => api('/finished-goods/dispatch', { body: { customer: v.customer, destination: v.destination, invoiceRef: v.invoiceRef, vehicleNo: v.vehicleNo, items: [{ fgLotId: v.fgLotId, quantity: v.quantity }] } })} submitLabel="Dispatch" />
      <FormDialog title="Reserve quantity" description={reserve ? `${reserve.batch.batchNumber} · available ${fmtNum(reserve.availableQty, 0)}, reserved ${fmtNum(reserve.reservedQty, 0)}. Use a negative number to release a reservation.` : undefined} open={!!reserve} onOpenChange={(o) => !o && setReserve(null)} invalidate={['/finished-goods']}
        fields={[{ name: 'quantity', label: 'Quantity to reserve / release', type: 'number', required: true }]} onSubmit={(v) => api(`/finished-goods/${reserve.id}/reserve`, { body: v })} />
    </>
  );
}
