'use client';
import { ColumnDef } from '@tanstack/react-table';
import { ArrowDownToLine, ArrowUpFromLine, Plus, QrCode } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DataTable } from '@/components/data-table';
import { FormDialog, useAction } from '@/components/form-dialog';
import { AdjustDialog, IssueDialog, LabelDialog, ReceiveDialog, TransferDialog } from '@/components/stock-actions';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader, Panel } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { daysUntil, fmtDate, fmtDateTime, fmtNum, humanize } from '@/lib/utils';

export default function Inventory() {
  const { can } = useAuth();
  const [dlg, setDlg] = React.useState<'in' | 'out' | 'to' | 'count' | null>(null);
  const [transfer, setTransfer] = React.useState<any>(null);
  const [adjust, setAdjust] = React.useState<any>(null);
  const [label, setLabel] = React.useState<any>(null);

  const lotCols: ColumnDef<any>[] = [
    { header: 'Lot', accessorKey: 'lotNumber', cell: (c) => <span className="id-text">{c.getValue() as string}</span> },
    { header: 'Material', id: 'm', accessorFn: (r) => r.rawMaterial.name, cell: ({ row: { original: r } }) => <Link href={`/raw-materials/${r.rawMaterialId}`} className="hover:underline"><span className="id-text mr-1.5 text-muted-foreground">{r.rawMaterial.code}</span>{r.rawMaterial.name}</Link> },
    { header: 'Location', id: 'loc', accessorFn: (r) => `${r.warehouse.name}${r.bin ? ' · ' + r.bin.code : ''}`, cell: (c) => <span className="text-muted-foreground">{c.getValue() as string}</span> },
    { header: 'Available', accessorFn: (r) => Number(r.availableQty), cell: ({ row: { original: r } }) => <span className="num">{fmtNum(r.availableQty, 3)} {r.rawMaterial.uom}</span> },
    { header: 'Expiry', accessorKey: 'expiryDate', cell: ({ row: { original: r } }) => { const d = daysUntil(r.expiryDate); return <span className="num">{fmtDate(r.expiryDate)}{d !== null && d >= 0 && d <= 90 && <span className="ml-1.5 text-xs text-warning">{d} d</span>}{d !== null && d < 0 && <span className="ml-1.5 text-xs text-danger">expired</span>}</span>; } },
    { header: 'Status', accessorKey: 'status', cell: (c) => <StatusBadge status={c.getValue() as string} /> },
    { header: '', id: 'a', enableSorting: false, cell: ({ row: { original: r } }) => (
      <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="icon" title="QR label" onClick={() => setLabel(r)}><QrCode className="h-4 w-4" /></Button>
        {can('stock:transfer') && Number(r.availableQty) > 0 && <Button variant="ghost" size="sm" onClick={() => setTransfer(r)}>Transfer</Button>}
        {can('stock:adjust') && <Button variant="ghost" size="sm" onClick={() => setAdjust(r)}>Adjust</Button>}
      </div>) },
  ];
  const ledgerCols: ColumnDef<any>[] = [
    { header: 'When', accessorKey: 'createdAt', cell: (c) => <span className="num text-muted-foreground">{fmtDateTime(c.getValue() as string)}</span> },
    { header: 'Type', accessorKey: 'type', cell: (c) => <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{humanize(c.getValue() as string)}</span> },
    { header: 'Item', id: 'i', accessorFn: (r) => r.materialLot?.rawMaterial.name ?? r.fgLot?.product.name },
    { header: 'Lot / batch', id: 'l', accessorFn: (r) => r.materialLot?.lotNumber ?? r.fgLot?.batch.batchNumber, cell: (c) => <span className="id-text">{c.getValue() as string}</span> },
    { header: 'Quantity', accessorFn: (r) => Number(r.quantity), cell: (c) => { const v = c.getValue() as number; return <span className={`num font-medium ${v < 0 ? 'text-danger' : 'text-success'}`}>{v > 0 ? '+' : ''}{fmtNum(v, 3)}</span>; } },
    { header: 'Balance', accessorFn: (r) => Number(r.balanceAfter), cell: (c) => <span className="num">{fmtNum(c.getValue(), 3)}</span> },
    { header: 'Reference', accessorKey: 'reference', cell: (c) => <span className="id-text text-muted-foreground">{c.getValue() as string}</span> },
    { header: 'Reason', accessorKey: 'reason', cell: (c) => <span className="text-muted-foreground">{c.getValue() as string}</span> },
  ];

  return (
    <>
      <PageHeader title="Stock & lots" description="Every lot with its location, expiry and QC status — plus the full immutable stock ledger."
        actions={<>{can('stock:create') && <Button variant="outline" onClick={() => setDlg('in')}><ArrowDownToLine className="h-4 w-4" />Stock in</Button>}{can('stock:create') && <Button variant="outline" onClick={() => setDlg('out')}><ArrowUpFromLine className="h-4 w-4" />Stock out</Button>}</>} />
      <Tabs defaultValue="lots">
        <TabsList><TabsTrigger value="lots">Lots</TabsTrigger><TabsTrigger value="ledger">Stock ledger</TabsTrigger><TabsTrigger value="transfers">Transfer orders</TabsTrigger><TabsTrigger value="counts">Inventory reconciliation</TabsTrigger></TabsList>
        <TabsContent value="lots"><DataTable endpoint="/inventory/lots" columns={lotCols} search="Search lot, code or material…" filters={[{ key: 'status', label: 'Status', options: ['QUARANTINE', 'APPROVED', 'REJECTED', 'EXPIRED', 'DEPLETED'].map((v) => ({ value: v, label: humanize(v) })) }, { key: 'expiringInDays', label: 'Expiring', options: [{ value: '30', label: '≤ 30 days' }, { value: '60', label: '≤ 60 days' }, { value: '90', label: '≤ 90 days' }] }]} /></TabsContent>
        <TabsContent value="ledger"><DataTable endpoint="/inventory/ledger" columns={ledgerCols} pageSize={50} search={false} filters={[{ key: 'type', label: 'Type', options: ['RECEIPT', 'ISSUE', 'CONSUMPTION', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT', 'PRODUCTION_OUTPUT', 'DISPATCH', 'WRITE_OFF'].map((v) => ({ value: v, label: humanize(v) })) }]} /></TabsContent>
        <TabsContent value="transfers"><TransferOrders onNew={() => setDlg('to')} /></TabsContent>
        <TabsContent value="counts"><Counts onNew={() => setDlg('count')} /></TabsContent>
      </Tabs>
      <ReceiveDialog open={dlg === 'in'} onOpenChange={(o) => !o && setDlg(null)} /><IssueDialog open={dlg === 'out'} onOpenChange={(o) => !o && setDlg(null)} />
      <TransferDialog lot={transfer} onClose={() => setTransfer(null)} /><AdjustDialog lot={adjust} onClose={() => setAdjust(null)} /><LabelDialog lot={label} onClose={() => setLabel(null)} />
      <FormDialog title="New transfer order" open={dlg === 'to'} onOpenChange={(o) => !o && setDlg(null)} invalidate={['transfer-orders']}
        fields={[{ name: 'fromWarehouseId', label: 'From warehouse', type: 'select', required: true, half: true, optionsFrom: { endpoint: '/warehouses', label: (r) => r.name } }, { name: 'toWarehouseId', label: 'To warehouse', type: 'select', required: true, half: true, optionsFrom: { endpoint: '/warehouses', label: (r) => r.name } }, { name: 'materialLotId', label: 'Lot', type: 'select', required: true, optionsFrom: { endpoint: '/inventory/lots', query: { status: 'APPROVED' }, label: (r) => `${r.rawMaterial.code} · ${r.lotNumber} (${r.availableQty} ${r.rawMaterial.uom})` } }, { name: 'quantity', label: 'Quantity', type: 'number', required: true }, { name: 'notes', label: 'Notes' }]}
        onSubmit={(v) => api('/inventory/transfer-orders', { body: { fromWarehouseId: v.fromWarehouseId, toWarehouseId: v.toWarehouseId, notes: v.notes, items: [{ materialLotId: v.materialLotId, quantity: v.quantity }] } })} />
      <FormDialog title="Start inventory count" description="Snapshots current system quantities for a warehouse so physical counts can be compared." open={dlg === 'count'} onOpenChange={(o) => !o && setDlg(null)} invalidate={['counts']}
        fields={[{ name: 'warehouseId', label: 'Warehouse', type: 'select', required: true, optionsFrom: { endpoint: '/warehouses', label: (r) => r.name } }]} onSubmit={(v) => api('/inventory/counts', { body: v })} submitLabel="Start count" />
    </>
  );
}

function TransferOrders({ onNew }: { onNew: () => void }) {
  const { can } = useAuth(); const act = useAction();
  const { data } = useQuery({ queryKey: ['transfer-orders'], queryFn: () => api<any[]>('/inventory/transfer-orders') });
  return (
    <Panel flush title="Transfer orders" action={can('warehouse:create') && <Button size="sm" onClick={onNew}><Plus className="h-3.5 w-3.5" />New</Button>}>
      <table className="w-full text-sm"><thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr>{['Number', 'From', 'To', 'Lines', 'Status', 'Created', ''].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
        <tbody>{data?.map((t) => <tr key={t.id} className="border-t"><td className="px-3 py-2 id-text">{t.trfNumber}</td><td className="px-3 py-2">{t.from.name}</td><td className="px-3 py-2">{t.to.name}</td><td className="px-3 py-2 num">{t.items.length}</td><td className="px-3 py-2"><StatusBadge status={t.status} /></td><td className="px-3 py-2 text-muted-foreground">{fmtDate(t.createdAt)}</td>
          <td className="px-3 py-2 text-right">{t.status === 'DRAFT' && can('stock:transfer') && <Button size="sm" variant="subtle" onClick={() => act(() => api(`/inventory/transfer-orders/${t.id}/execute`, { method: 'POST' }), { ok: 'Transfer executed', invalidate: ['transfer-orders', '/inventory/lots'] })}>Execute</Button>}</td></tr>)}
          {!data?.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No transfer orders.</td></tr>}</tbody></table>
    </Panel>
  );
}

function Counts({ onNew }: { onNew: () => void }) {
  const { can } = useAuth(); const qc = useQueryClient(); const act = useAction();
  const [open, setOpen] = React.useState<string | null>(null);
  const { data } = useQuery({ queryKey: ['counts'], queryFn: () => api<any[]>('/inventory/counts') });
  const { data: detail } = useQuery({ queryKey: ['count', open], enabled: !!open, queryFn: () => api<any>(`/inventory/counts/${open}`) });
  const [vals, setVals] = React.useState<Record<string, string>>({});
  React.useEffect(() => setVals(Object.fromEntries((detail?.items ?? []).map((i: any) => [i.id, i.countedQty ?? '']))), [detail]);

  if (open && detail) {
    const dirty = detail.items.filter((i: any) => vals[i.id] !== '' && vals[i.id] !== undefined);
    return (
      <Panel flush title={`Count ${detail.countNumber} · ${detail.warehouse.name}`} action={<div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setOpen(null)}>Back</Button>
        {detail.status === 'OPEN' && <><Button size="sm" variant="subtle" onClick={() => act(() => api(`/inventory/counts/${open}/items`, { method: 'PATCH', body: { items: dirty.map((i: any) => ({ id: i.id, countedQty: Number(vals[i.id]) })) } }), { ok: 'Counts saved', invalidate: ['count'] })}>Save counts</Button>
        {can('stock:adjust') && <Button size="sm" onClick={() => act(() => api(`/inventory/counts/${open}/reconcile`, { method: 'POST' }), { ok: 'Reconciled — variances posted as adjustments', invalidate: ['counts', 'count'] })}>Reconcile</Button>}</>}</div>}>
        <table className="w-full text-sm"><thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Material</th><th className="px-3 py-2 text-right">System</th><th className="px-3 py-2 text-right">Counted</th><th className="px-3 py-2 text-right">Variance</th></tr></thead>
          <tbody>{detail.items.map((i: any) => { const c = vals[i.id]; const v = c !== '' && c !== undefined ? Number(c) - Number(i.systemQty) : null; return <tr key={i.id} className="border-t"><td className="px-3 py-1.5">{i.rawMaterial.name}</td><td className="px-3 py-1.5 text-right num">{fmtNum(i.systemQty, 3)} {i.rawMaterial.uom}</td><td className="px-3 py-1.5 text-right"><Input type="number" step="any" disabled={detail.status !== 'OPEN'} className="ml-auto h-8 w-28 text-right num" value={vals[i.id] ?? ''} onChange={(e) => setVals((s) => ({ ...s, [i.id]: e.target.value }))} /></td><td className={`px-3 py-1.5 text-right num ${v ? (v < 0 ? 'text-danger' : 'text-warning') : 'text-muted-foreground'}`}>{v === null ? '—' : fmtNum(v, 3)}</td></tr>; })}</tbody></table>
      </Panel>
    );
  }
  return (
    <Panel flush title="Inventory reconciliation (cycle counts)" action={can('warehouse:create') && <Button size="sm" onClick={onNew}><Plus className="h-3.5 w-3.5" />New count</Button>}>
      <table className="w-full text-sm"><thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr>{['Count', 'Warehouse', 'Lines', 'Status', 'Started'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
        <tbody>{data?.map((c) => <tr key={c.id} className="cursor-pointer border-t hover:bg-tint/50" onClick={() => setOpen(c.id)}><td className="px-3 py-2 id-text">{c.countNumber}</td><td className="px-3 py-2">{c.warehouse.name}</td><td className="px-3 py-2 num">{c._count.items}</td><td className="px-3 py-2"><StatusBadge status={c.status} /></td><td className="px-3 py-2 text-muted-foreground">{fmtDate(c.createdAt)}</td></tr>)}
          {!data?.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No counts yet.</td></tr>}</tbody></table>
    </Panel>
  );
}
