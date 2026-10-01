'use client';
import { useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { ArrowDownToLine, ArrowUpFromLine, ExternalLink, Pencil, QrCode } from 'lucide-react';
import { useParams } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { AdjustDialog, IssueDialog, LabelDialog, ReceiveDialog, TransferDialog } from '@/components/stock-actions';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { KV, PageHeader, Panel, Skeleton } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, openFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { daysUntil, fmtDate, fmtMoney2, fmtNum } from '@/lib/utils';
import { MATERIAL_FIELDS } from '@/components/material-fields';

export default function MaterialDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { data: m, isLoading } = useQuery({ queryKey: ['/raw-materials', id], queryFn: () => api<any>(`/raw-materials/${id}`) });
  const [dlg, setDlg] = React.useState<'in' | 'out' | 'edit' | null>(null);
  const [transfer, setTransfer] = React.useState<any>(null);
  const [adjust, setAdjust] = React.useState<any>(null);
  const [label, setLabel] = React.useState<any>(null);
  if (isLoading || !m) return <Skeleton className="h-64" />;

  const lots = m.lots.map((l: any) => ({ ...l, rawMaterial: { code: m.code, name: m.name, uom: m.uom } }));
  return (
    <>
      <PageHeader
        title={<><span className="id-text mr-2 text-muted-foreground">{m.code}</span>{m.name}</>}
        description={<span className="inline-flex items-center gap-2"><StatusBadge status={m.category} className="!bg-muted !text-foreground/80" /><StatusBadge status={m.status} /> {m.storageCondition}</span>}
        actions={<>
          {can('stock:create') && <Button variant="outline" onClick={() => setDlg('in')}><ArrowDownToLine className="h-4 w-4" />Stock in</Button>}
          {can('stock:create') && <Button variant="outline" onClick={() => setDlg('out')}><ArrowUpFromLine className="h-4 w-4" />Stock out</Button>}
          {can('material:update') && <Button variant="outline" onClick={() => setDlg('edit')}><Pencil className="h-4 w-4" />Edit</Button>}
        </>}
      />
      <div className="mb-5 grid grid-cols-2 divide-x rounded-lg border bg-card sm:grid-cols-5">
        {([['Usable', `${fmtNum(m.usableStock, 3)} ${m.uom}`], ['In quarantine', `${fmtNum(m.quarantineStock, 3)} ${m.uom}`], ['Minimum', fmtNum(m.minStock, 0)], ['Reorder level', fmtNum(m.reorderLevel, 0)], ['Last price', fmtMoney2(m.purchasePrice)]] as const).map(([k, v]) => (
          <div key={k} className="px-4 py-3"><div className="text-xs text-muted-foreground">{k}</div><div className="num mt-0.5 text-lg font-semibold">{v}</div></div>
        ))}
      </div>

      <Tabs defaultValue="lots">
        <TabsList><TabsTrigger value="lots">Lots ({m.lots.length})</TabsTrigger><TabsTrigger value="prices">Price history</TabsTrigger><TabsTrigger value="specs">Test specifications</TabsTrigger><TabsTrigger value="info">Details</TabsTrigger></TabsList>
        <TabsContent value="lots">
          <Panel flush>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr>{['Lot', 'Supplier lot', 'Location', 'Available', 'Cost', 'Expiry', 'Status', ''].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                <tbody>
                  {lots.map((l: any) => { const d = daysUntil(l.expiryDate); return (
                    <tr key={l.id} className="border-t">
                      <td className="px-3 py-2 id-text">{l.lotNumber}</td><td className="px-3 py-2 id-text text-muted-foreground">{l.supplierLot ?? '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{l.warehouse?.name}{l.bin ? ` · ${l.bin.code}` : ''}</td>
                      <td className="px-3 py-2 num">{fmtNum(l.availableQty, 3)} {m.uom}</td><td className="px-3 py-2 num">{fmtMoney2(l.unitCost)}</td>
                      <td className="px-3 py-2 num">{fmtDate(l.expiryDate)}{d !== null && d >= 0 && d <= 90 && <span className="ml-1.5 text-xs text-warning">{d} d</span>}</td>
                      <td className="px-3 py-2"><StatusBadge status={l.status} /></td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <Button variant="ghost" size="icon" title="QR label" onClick={() => setLabel(l)}><QrCode className="h-4 w-4" /></Button>
                        {l.coaDocumentId && <Button variant="ghost" size="icon" title="Certificate of analysis" onClick={() => openFile(`/documents/${l.coaDocumentId}/download`, { query: { inline: true } }).catch((e) => toast.error(e.message))}><ExternalLink className="h-4 w-4" /></Button>}
                        {can('stock:transfer') && Number(l.availableQty) > 0 && <Button variant="ghost" size="sm" onClick={() => setTransfer(l)}>Transfer</Button>}
                        {can('stock:adjust') && <Button variant="ghost" size="sm" onClick={() => setAdjust(l)}>Adjust</Button>}
                      </td>
                    </tr>); })}
                  {!lots.length && <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No lots received yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </Panel>
        </TabsContent>
        <TabsContent value="prices"><Panel flush><table className="w-full text-sm"><thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Supplier</th><th className="px-3 py-2 text-right">Price</th><th className="px-3 py-2">Source</th></tr></thead><tbody>{m.prices.map((p: any) => <tr key={p.id} className="border-t"><td className="px-3 py-2">{fmtDate(p.effectiveDate)}</td><td className="px-3 py-2">{p.supplier.name}</td><td className="px-3 py-2 text-right num">{fmtMoney2(p.price)}</td><td className="px-3 py-2 id-text text-muted-foreground">{p.source}</td></tr>)}{!m.prices.length && <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">No purchases recorded.</td></tr>}</tbody></table></Panel></TabsContent>
        <TabsContent value="specs"><Panel flush><table className="w-full text-sm"><thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Test</th><th className="px-3 py-2">Method</th><th className="px-3 py-2">Limits</th></tr></thead><tbody>{m.specs.map((s: any) => <tr key={s.id} className="border-t"><td className="px-3 py-2">{s.testName}</td><td className="px-3 py-2 text-muted-foreground">{s.method ?? '—'}</td><td className="px-3 py-2 num">{s.textSpec ?? `${s.lowerLimit ?? ''}${s.lowerLimit != null && s.upperLimit != null ? ' – ' : s.upperLimit != null ? '≤ ' : '≥ '}${s.upperLimit ?? ''} ${s.unit ?? ''}`}</td></tr>)}{!m.specs.length && <tr><td colSpan={3} className="px-3 py-8 text-center text-muted-foreground">No specifications defined.</td></tr>}</tbody></table></Panel></TabsContent>
        <TabsContent value="info"><Panel><KV cols={3} items={[['Default supplier', m.defaultSupplier?.name], ['Unit of measure', m.uom], ['Shelf life', m.shelfLifeMonths ? `${m.shelfLifeMonths} months` : '—'], ['HSN code', m.hsnCode], ['GST', m.gstRate ? `${m.gstRate}%` : '—'], ['Barcode', <span key="b" className="id-text">{m.barcode}</span>]]} /></Panel></TabsContent>
      </Tabs>

      <ReceiveDialog open={dlg === 'in'} onOpenChange={(o) => !o && setDlg(null)} materialId={id} />
      <IssueDialog open={dlg === 'out'} onOpenChange={(o) => !o && setDlg(null)} materialId={id} />
      <FormDialog title={`Edit ${m.code}`} fields={MATERIAL_FIELDS.filter((f) => f.name !== 'code')} open={dlg === 'edit'} onOpenChange={(o) => !o && setDlg(null)} wide initial={m} invalidate={['/raw-materials']} onSubmit={(v) => api(`/raw-materials/${id}`, { method: 'PATCH', body: v })} />
      <TransferDialog lot={transfer} onClose={() => setTransfer(null)} /><AdjustDialog lot={adjust} onClose={() => setAdjust(null)} /><LabelDialog lot={label} onClose={() => setLabel(null)} />
    </>
  );
}
