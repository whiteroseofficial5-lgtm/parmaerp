'use client';
import { useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { FileText, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { DataTable } from '@/components/data-table';
import { FormDialog, useAction, useOptions } from '@/components/form-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/input';
import { PageHeader, Panel } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, openFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtMoney2, fmtNum, humanize } from '@/lib/utils';

export default function Purchase() {
  const { can } = useAuth(); const act = useAction();
  const [po, setPo] = React.useState(false); const [grn, setGrn] = React.useState<any>(null); const [inv, setInv] = React.useState<any>(null); const [pr, setPr] = React.useState(false);
  const pdf = (path: string) => openFile(path).catch((e) => toast.error(e.message));

  const poCols: ColumnDef<any>[] = [
    { header: 'PO', accessorKey: 'poNumber', cell: (c) => <span className="id-text font-medium">{c.getValue() as string}</span> }, { header: 'Supplier', id: 's', accessorFn: (r) => r.supplier.name },
    { header: 'Date', accessorKey: 'orderDate', cell: (c) => <span className="num text-muted-foreground">{fmtDate(c.getValue() as string)}</span> }, { header: 'Lines', id: 'l', accessorFn: (r) => r._count.items, cell: (c) => <span className="num">{c.getValue() as number}</span> },
    { header: 'Total', accessorFn: (r) => Number(r.total), cell: (c) => <span className="num">{fmtMoney2(c.getValue())}</span> }, { header: 'Status', accessorKey: 'status', cell: (c) => <StatusBadge status={c.getValue() as string} /> },
    { header: '', id: 'a', enableSorting: false, cell: ({ row: { original: r } }) => <div className="flex justify-end gap-1">
      {r.status === 'DRAFT' && can('purchase:approve') && <Button size="sm" variant="subtle" onClick={() => act(() => api(`/purchase/orders/${r.id}/approve`, { method: 'POST' }), { ok: 'PO approved', invalidate: ['/purchase/orders'] })}>Approve</Button>}
      {['APPROVED', 'PARTIALLY_RECEIVED'].includes(r.status) && can('purchase:grn') && <Button size="sm" variant="subtle" onClick={() => setGrn(r)}>Receive</Button>}
      <Button size="sm" variant="ghost" onClick={() => pdf(`/purchase/orders/${r.id}/pdf`)} aria-label="PO PDF"><FileText className="h-4 w-4" /></Button></div> },
  ];
  const grnCols: ColumnDef<any>[] = [
    { header: 'GRN', accessorKey: 'grnNumber', cell: (c) => <span className="id-text font-medium">{c.getValue() as string}</span> }, { header: 'Supplier', id: 's', accessorFn: (r) => r.supplier.name }, { header: 'PO', id: 'p', accessorFn: (r) => r.po?.poNumber ?? '—', cell: (c) => <span className="id-text text-muted-foreground">{c.getValue() as string}</span> },
    { header: 'Received', accessorKey: 'receivedAt', cell: (c) => <span className="num text-muted-foreground">{fmtDate(c.getValue() as string)}</span> }, { header: 'Lines', id: 'l', accessorFn: (r) => r._count.items }, { header: 'Status', accessorKey: 'status', cell: (c) => <StatusBadge status={c.getValue() as string} /> },
    { header: '', id: 'a', enableSorting: false, cell: ({ row: { original: r } }) => <Button size="sm" variant="ghost" onClick={() => pdf(`/purchase/grn/${r.id}/pdf`)} aria-label="GRN PDF"><FileText className="h-4 w-4" /></Button> },
  ];
  const invCols: ColumnDef<any>[] = [
    { header: 'Invoice', accessorKey: 'invoiceNumber', cell: (c) => <span className="id-text font-medium">{c.getValue() as string}</span> }, { header: 'Date', accessorKey: 'invoiceDate', cell: (c) => <span className="num text-muted-foreground">{fmtDate(c.getValue() as string)}</span> },
    { header: 'Supplier', id: 's', accessorFn: (r) => r.supplier.name }, { header: 'PO', id: 'p', accessorFn: (r) => r.po?.poNumber ?? '—', cell: (c) => <span className="id-text text-muted-foreground">{c.getValue() as string}</span> },
    { header: 'Total', accessorFn: (r) => Number(r.total), cell: (c) => <span className="num">{fmtMoney2(c.getValue())}</span> }, { header: 'Source', accessorKey: 'source', cell: (c) => (c.getValue() === 'AI_IMPORT' ? <span className="rounded bg-tint px-1.5 py-0.5 text-xs text-primary">Scanned</span> : <span className="text-muted-foreground">Manual</span>) },
    { header: 'Status', accessorKey: 'status', cell: (c) => <StatusBadge status={c.getValue() as string} /> },
  ];

  return (
    <>
      <PageHeader title="Purchasing" description="Requisition → purchase order → goods receipt → supplier invoice, with automatic invoice-to-PO matching."
        actions={can('purchase:create') && <><Button variant="outline" onClick={() => act(async () => { const r = await api<any>('/purchase/requisitions/auto', { method: 'POST' }); toast.info(r.message ?? `Requisition ${r.requisition.prNumber} created`); }, { invalidate: ['/purchase/requisitions'] })}>Auto-requisition from reorder levels</Button><Button onClick={() => setPo(true)}><Plus className="h-4 w-4" />New purchase order</Button></>} />
      <Tabs defaultValue="po">
        <TabsList><TabsTrigger value="po">Purchase orders</TabsTrigger><TabsTrigger value="grn">Goods receipts</TabsTrigger><TabsTrigger value="inv">Supplier invoices</TabsTrigger><TabsTrigger value="pr">Requisitions</TabsTrigger></TabsList>
        <TabsContent value="po"><DataTable endpoint="/purchase/orders" columns={poCols} search="Search PO or supplier…" filters={[{ key: 'status', label: 'Status', options: ['DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'].map((v) => ({ value: v, label: humanize(v) })) }]} /></TabsContent>
        <TabsContent value="grn"><DataTable endpoint="/purchase/grn" columns={grnCols} search={false} /></TabsContent>
        <TabsContent value="inv"><DataTable endpoint="/purchase/invoices" columns={invCols} search="Search invoice or supplier…" onRowClick={setInv} filters={[{ key: 'status', label: 'Status', options: ['MATCHED', 'MISMATCH', 'APPROVED', 'REJECTED', 'PENDING_REVIEW'].map((v) => ({ value: v, label: humanize(v) })) }]} /></TabsContent>
        <TabsContent value="pr"><Requisitions onNew={() => setPr(true)} /></TabsContent>
      </Tabs>
      <PoDialog open={po} onOpenChange={setPo} />
      <GrnDialog po={grn} onClose={() => setGrn(null)} />
      <InvoiceDialog inv={inv} onClose={() => setInv(null)} />
      <FormDialog title="New requisition" open={pr} onOpenChange={setPr} invalidate={['/purchase/requisitions']} fields={[{ name: 'rawMaterialId', label: 'Material', type: 'select', required: true, optionsFrom: { endpoint: '/raw-materials', label: (r) => `${r.code} · ${r.name}` } }, { name: 'quantity', label: 'Quantity', type: 'number', required: true }, { name: 'notes', label: 'Notes' }]} onSubmit={(v) => api('/purchase/requisitions', { body: { notes: v.notes, items: [{ rawMaterialId: v.rawMaterialId, quantity: v.quantity }] } })} />
    </>
  );
}

function Requisitions({ onNew }: { onNew: () => void }) {
  const { can } = useAuth(); const act = useAction();
  const { data } = useQuery({ queryKey: ['/purchase/requisitions'], queryFn: () => api<any[]>('/purchase/requisitions') });
  return <Panel flush title="Purchase requisitions" action={can('purchase:create') && <Button size="sm" onClick={onNew}><Plus className="h-3.5 w-3.5" />New</Button>}><table className="w-full text-sm"><thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr>{['PR', 'Items', 'Notes', 'Status', 'Date', ''].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
    <tbody>{data?.map((r) => <tr key={r.id} className="border-t align-top"><td className="px-3 py-2 id-text">{r.prNumber}</td><td className="px-3 py-2">{r.items.map((i: any) => <div key={i.id} className="text-[0.8125rem]">{i.rawMaterial.name} · <span className="num">{fmtNum(i.quantity, 1)} {i.rawMaterial.uom}</span></div>)}</td><td className="px-3 py-2 text-muted-foreground">{r.notes}</td><td className="px-3 py-2"><StatusBadge status={r.status} /></td><td className="px-3 py-2 text-muted-foreground">{fmtDate(r.createdAt)}</td>
      <td className="px-3 py-2 text-right">{r.status === 'SUBMITTED' && can('purchase:approve') && <><Button size="sm" variant="subtle" onClick={() => act(() => api(`/purchase/requisitions/${r.id}/decision`, { body: { approve: true } }), { ok: 'Approved', invalidate: ['/purchase/requisitions'] })}>Approve</Button><Button size="sm" variant="ghost" onClick={() => act(() => api(`/purchase/requisitions/${r.id}/decision`, { body: { approve: false } }), { ok: 'Rejected', invalidate: ['/purchase/requisitions'] })}>Reject</Button></>}</td></tr>)}{!data?.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No requisitions.</td></tr>}</tbody></table></Panel>;
}

function PoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const suppliers = useOptions({ endpoint: '/suppliers', query: { isApproved: 'true' }, label: (r) => r.name });
  const { data: mats } = useQuery({ queryKey: ['mat-all'], queryFn: () => api<any>('/raw-materials', { query: { pageSize: 200 } }), enabled: open });
  const [supplierId, setSup] = React.useState(''); const [rows, setRows] = React.useState([{ rawMaterialId: '', quantity: '', unitPrice: '', taxPct: '12' }]); const [busy, setBusy] = React.useState(false); const act = useAction();
  const total = rows.reduce((s, r) => s + Number(r.quantity || 0) * Number(r.unitPrice || 0) * (1 + Number(r.taxPct || 0) / 100), 0);
  const set = (i: number, p: object) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const save = async () => { setBusy(true); const ok = await act(() => api('/purchase/orders', { body: { supplierId, items: rows.filter((r) => r.rawMaterialId).map((r) => ({ rawMaterialId: r.rawMaterialId, quantity: Number(r.quantity), unitPrice: Number(r.unitPrice), taxPct: Number(r.taxPct) })) } }), { ok: 'Purchase order created', invalidate: ['/purchase/orders'] }); setBusy(false); if (ok) { onOpenChange(false); setRows([{ rawMaterialId: '', quantity: '', unitPrice: '', taxPct: '12' }]); } };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent title="New purchase order" description="Only approved vendors are listed." wide>
      <div className="space-y-3"><div><Label htmlFor="sup">Supplier</Label><Select id="sup" value={supplierId} onChange={(e) => setSup(e.target.value)}><option value="">Select supplier…</option>{suppliers.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>
        <table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th className="pb-1">Material</th><th className="w-24 pb-1">Qty</th><th className="w-28 pb-1">Rate (₹)</th><th className="w-20 pb-1">GST %</th><th className="w-8" /></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}><td className="pr-2 pb-1.5"><Select value={r.rawMaterialId} onChange={(e) => { const m = mats?.data.find((x: any) => x.id === e.target.value); set(i, { rawMaterialId: e.target.value, unitPrice: r.unitPrice || String(Number(m?.purchasePrice ?? '')), taxPct: m?.gstRate ? String(Number(m.gstRate)) : r.taxPct }); }} aria-label="Material"><option value="">Select…</option>{mats?.data.map((m: any) => <option key={m.id} value={m.id}>{m.code} · {m.name} ({m.uom})</option>)}</Select></td><td className="pr-2 pb-1.5"><Input type="number" className="num" value={r.quantity} onChange={(e) => set(i, { quantity: e.target.value })} aria-label="Quantity" /></td><td className="pr-2 pb-1.5"><Input type="number" className="num" value={r.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} aria-label="Rate" /></td><td className="pr-2 pb-1.5"><Input type="number" className="num" value={r.taxPct} onChange={(e) => set(i, { taxPct: e.target.value })} aria-label="GST percent" /></td><td className="pb-1.5"><Button variant="ghost" size="icon" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label="Remove line"><Trash2 className="h-4 w-4" /></Button></td></tr>)}</tbody></table>
        <div className="flex items-center justify-between"><Button variant="subtle" size="sm" onClick={() => setRows((r) => [...r, { rawMaterialId: '', quantity: '', unitPrice: '', taxPct: '12' }])}><Plus className="h-3.5 w-3.5" />Add line</Button><span className="text-sm">Total incl. GST <b className="num ml-1">{fmtMoney2(total)}</b></span></div>
        <div className="flex justify-end gap-2 pt-2"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={busy} disabled={!supplierId} onClick={save}>Create PO</Button></div></div>
    </DialogContent></Dialog>
  );
}

function GrnDialog({ po, onClose }: { po: any; onClose: () => void }) {
  const { data: detail } = useQuery({ queryKey: ['/purchase/orders', po?.id], enabled: !!po, queryFn: () => api<any>(`/purchase/orders/${po.id}`) });
  const wh = useOptions(po ? { endpoint: '/warehouses', label: (r) => r.name } : undefined);
  const [warehouseId, setW] = React.useState(''); const [lines, setLines] = React.useState<Record<string, any>>({}); const [busy, setBusy] = React.useState(false); const act = useAction();
  React.useEffect(() => { if (detail) setLines(Object.fromEntries(detail.items.map((i: any) => [i.id, { lotNumber: '', quantity: String(Math.max(Number(i.quantity) - Number(i.receivedQty), 0)), rejectedQty: '0', expiryDate: '', mfgDate: '' }]))); }, [detail]);
  const set = (id: string, p: object) => setLines((l) => ({ ...l, [id]: { ...l[id], ...p } }));
  const save = async () => { setBusy(true); const items = detail.items.filter((i: any) => lines[i.id]?.lotNumber && Number(lines[i.id].quantity) > 0).map((i: any) => ({ poItemId: i.id, rawMaterialId: i.rawMaterialId, lotNumber: lines[i.id].lotNumber, quantity: Number(lines[i.id].quantity), rejectedQty: Number(lines[i.id].rejectedQty || 0), unitCost: Number(i.unitPrice), mfgDate: lines[i.id].mfgDate || undefined, expiryDate: lines[i.id].expiryDate || undefined })); const ok = await act(() => api('/purchase/grn', { body: { poId: po.id, warehouseId, items } }), { ok: 'GRN posted — lots are in quarantine pending QC', invalidate: ['/purchase/orders', '/purchase/grn', '/qc/samples'] }); setBusy(false); if (ok) onClose(); };
  return (
    <Dialog open={!!po} onOpenChange={(o) => !o && onClose()}><DialogContent title={`Receive against ${po?.poNumber ?? ''}`} description="Enter the lot details from the delivery. Every lot enters QUARANTINE and a QC sample is raised automatically." wide>
      <div className="space-y-3"><div><Label htmlFor="w">Receiving warehouse</Label><Select id="w" value={warehouseId} onChange={(e) => setW(e.target.value)}><option value="">Select…</option>{wh.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>
        {detail?.items.map((i: any) => <div key={i.id} className="rounded border p-3"><div className="mb-2 flex justify-between text-sm"><span className="font-medium">{i.rawMaterial.name}</span><span className="num text-muted-foreground">ordered {fmtNum(i.quantity, 1)} · received {fmtNum(i.receivedQty, 1)} {i.rawMaterial.uom}</span></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5"><div className="sm:col-span-2"><Label>Lot number</Label><Input value={lines[i.id]?.lotNumber ?? ''} onChange={(e) => set(i.id, { lotNumber: e.target.value })} /></div><div><Label>Quantity</Label><Input type="number" className="num" value={lines[i.id]?.quantity ?? ''} onChange={(e) => set(i.id, { quantity: e.target.value })} /></div><div><Label>Rejected</Label><Input type="number" className="num" value={lines[i.id]?.rejectedQty ?? ''} onChange={(e) => set(i.id, { rejectedQty: e.target.value })} /></div><div><Label>Expiry</Label><Input type="date" value={lines[i.id]?.expiryDate ?? ''} onChange={(e) => set(i.id, { expiryDate: e.target.value })} /></div></div></div>)}
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!warehouseId} onClick={save}>Post GRN</Button></div></div>
    </DialogContent></Dialog>
  );
}

function InvoiceDialog({ inv, onClose }: { inv: any; onClose: () => void }) {
  const { can } = useAuth(); const act = useAction();
  const { data: i } = useQuery({ queryKey: ['/purchase/invoices', inv?.id], enabled: !!inv, queryFn: () => api<any>(`/purchase/invoices/${inv.id}`) });
  const m = i?.matchResult;
  return (
    <Dialog open={!!inv} onOpenChange={(o) => !o && onClose()}><DialogContent title={`Invoice ${inv?.invoiceNumber ?? ''}`} description={i ? `${i.supplier.name} · ${fmtDate(i.invoiceDate)} · ${fmtMoney2(i.total)}` : undefined} wide>
      {i && <div className="space-y-4">
        <div className="flex items-center gap-2"><StatusBadge status={i.status} />{i.po && <span className="text-sm text-muted-foreground">PO <span className="id-text">{i.po.poNumber}</span></span>}{i.grn && <span className="text-sm text-muted-foreground">GRN <span className="id-text">{i.grn.grnNumber}</span></span>}</div>
        {m?.flags?.length > 0 && <div><h3 className="mb-1 text-sm font-semibold">Match findings</h3><ul className="divide-y rounded border">{m.flags.map((f: any, k: number) => <li key={k} className="flex gap-3 px-3 py-2 text-sm"><StatusBadge status={f.severity} className="h-fit" /><div><span className="id-text text-muted-foreground">{f.code}</span><div>{f.message}</div></div></li>)}</ul></div>}
        {m?.priceMismatch?.length > 0 && <div><h3 className="mb-1 text-sm font-semibold">Price mismatches</h3><ul className="text-sm">{m.priceMismatch.map((p: any, k: number) => <li key={k}>{p.description}: invoiced <b className="num">{fmtMoney2(p.invoiced)}</b> vs {p.basis} <b className="num">{fmtMoney2(p.expected)}</b> ({p.deviationPct > 0 ? '+' : ''}{p.deviationPct}%)</li>)}</ul></div>}
        {m?.quantityMismatch?.length > 0 && <div><h3 className="mb-1 text-sm font-semibold">Quantity mismatches</h3><ul className="text-sm">{m.quantityMismatch.map((p: any, k: number) => <li key={k}>{p.description}: invoiced <b className="num">{fmtNum(p.invoiced, 2)}</b> vs {p.basis} <b className="num">{fmtNum(p.expected, 2)}</b></li>)}</ul></div>}
        <table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th className="pb-1">Item</th><th className="pb-1 text-right">Qty</th><th className="pb-1 text-right">Rate</th><th className="pb-1 text-right">Amount</th></tr></thead><tbody>{i.items.map((x: any) => <tr key={x.id} className="border-t"><td className="py-1.5">{x.description}{x.rawMaterial ? <span className="ml-2 id-text text-muted-foreground">{x.rawMaterial.code}</span> : <span className="ml-2 text-xs text-warning">unmapped</span>}</td><td className="num text-right">{fmtNum(x.quantity, 2)}</td><td className="num text-right">{fmtMoney2(x.unitPrice)}</td><td className="num text-right">{fmtMoney2(x.amount)}</td></tr>)}</tbody></table>
        <div className="flex justify-end gap-2">
          {i.document && <Button variant="outline" onClick={() => openFile(`/documents/${i.document.id}/download`, { query: { inline: true } }).catch((e) => toast.error(e.message))}>View original</Button>}
          {['MISMATCH', 'MATCHED', 'PENDING_REVIEW'].includes(i.status) && can('purchase:approve') && <><Button variant="danger" onClick={async () => { if (await act(() => api(`/purchase/invoices/${i.id}/reject`, { method: 'POST' }), { ok: 'Invoice rejected', invalidate: ['/purchase/invoices'] })) onClose(); }}>Reject</Button><Button variant="success" onClick={async () => { if (await act(() => api(`/purchase/invoices/${i.id}/approve`, { body: {} }), { ok: 'Invoice approved', invalidate: ['/purchase/invoices'] })) onClose(); }}>Approve{m?.status === 'MISMATCH' ? ' despite flags' : ''}</Button></>}
        </div></div>}
    </DialogContent></Dialog>
  );
}
