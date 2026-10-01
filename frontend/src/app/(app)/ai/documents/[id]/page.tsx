'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import { useOptions } from '@/components/form-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { PageHeader, Panel, Skeleton, Spinner } from '@/components/ui/misc';
import { api, blobUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, fmtMoney2 } from '@/lib/utils';

const get = (o: any, p: string) => p.split('.').reduce((a, k) => a?.[k], o);
const setIn = (o: any, p: string, v: any) => { const c = structuredClone(o ?? {}); const ks = p.split('.'); let t = c; ks.slice(0, -1).forEach((k) => (t = t[k] ??= {})); t[ks.at(-1)!] = v; return c; };

export default function Review() {
  const { id } = useParams<{ id: string }>(); const router = useRouter(); const qc = useQueryClient(); const { can } = useAuth();
  const { data: job, refetch } = useQuery({ queryKey: ['/ai/jobs', id], queryFn: () => api<any>(`/ai/jobs/${id}`), refetchInterval: (q) => (['UPLOADED', 'PROCESSING'].includes((q.state.data as any)?.status) ? 2500 : false) });
  const [c, setC] = React.useState<any>(null); const [busy, setBusy] = React.useState<string | null>(null); const [commit, setCommit] = React.useState(false);
  const [preview, setPreview] = React.useState<string>();
  const [opts, setOpts] = React.useState<any>({ deductStock: false, autoReceive: false, warehouseId: '' });
  const products = useOptions({ endpoint: '/products', label: (r) => `${r.name} ${r.strength ?? ''}` });
  const suppliers = useOptions({ endpoint: '/suppliers', label: (r) => r.name });
  const materials = useOptions({ endpoint: '/raw-materials', label: (r) => `${r.code} · ${r.name}` });
  const users = useOptions({ endpoint: '/users/lookup', label: (r) => r.name });
  const warehouses = useOptions({ endpoint: '/warehouses', label: (r) => r.name });
  const pos = useOptions(job?.kind === 'INVOICE' ? { endpoint: '/purchase/orders', label: (r) => r.poNumber } : undefined);

  React.useEffect(() => { if (job?.corrected) setC(job.corrected); }, [job?.id, job?.status, job?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { blobUrl(`/ai/jobs/${id}/file`).then(setPreview).catch(() => undefined); }, [id]);
  if (!job) return <Skeleton className="h-96" />;
  if (['UPLOADED', 'PROCESSING'].includes(job.status)) return <div className="flex flex-col items-center gap-3 py-24"><Spinner className="h-6 w-6" /><p className="text-sm text-muted-foreground">Reading {job.document.fileName}…</p></div>;

  const isBmr = job.kind === 'BMR'; const editable = job.status === 'REVIEW' && can(isBmr ? 'ai:bmr' : 'ai:invoice');
  const conf = job.extracted?.fieldConfidence ?? {}; const illeg: string[] = job.extracted?.illegibleFields ?? [];
  const low = (f: string) => (typeof conf[f] === 'number' && conf[f] < 0.75) || illeg.some((x) => x.toLowerCase().startsWith(f.toLowerCase().split('.')[0]));
  const F = ({ label, path, type = 'text', span = 1, conf: cf }: { label: string; path: string; type?: string; span?: number; conf?: string }) => (
    <div className={span === 2 ? 'sm:col-span-2' : ''}><label className="field-label" htmlFor={path}>{label}{low(cf ?? path) && <span className="ml-1.5 rounded bg-warning/15 px-1 text-[0.6875rem] text-warning">check</span>}</label>
      <Input id={path} type={type} disabled={!editable} value={get(c, path) ?? ''} onChange={(e) => setC((x: any) => setIn(x, path, type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value || null))} className={cn(low(cf ?? path) && 'border-warning')} /></div>
  );
  const Sel = ({ label, path, options }: { label: string; path: string; options: { value: string; label: string }[] }) => (
    <div><label className="field-label" htmlFor={path}>{label}</label><Select id={path} disabled={!editable} value={get(c, path) ?? ''} onChange={(e) => setC((x: any) => setIn(x, path, e.target.value || null))}><option value="">— not matched —</option>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>
  );
  const rowSet = (list: string, i: number, k: string, v: any) => setC((x: any) => { const n = structuredClone(x); n[list][i][k] = v; return n; });
  const Rows = ({ list, cols, blank }: { list: string; cols: { k: string; label: string; type?: string; w?: string; mat?: boolean }[]; blank: object }) => (
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr>{cols.map((x) => <th key={x.k} className="pb-1 pr-2 font-medium">{x.label}</th>)}<th /></tr></thead>
      <tbody>{(c?.[list] ?? []).map((r: any, i: number) => <tr key={i}>{cols.map((x) => <td key={x.k} className={cn('pb-1.5 pr-2', x.w)}>{x.mat ? <Select disabled={!editable} value={r[x.k] ?? ''} onChange={(e) => rowSet(list, i, x.k, e.target.value || null)} className={cn(!r[x.k] && 'border-warning')} aria-label={x.label}><option value="">unmapped</option>{materials.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select> : <Input disabled={!editable} type={x.type ?? 'text'} step="any" className={x.type === 'number' ? 'num' : ''} value={r[x.k] ?? ''} onChange={(e) => rowSet(list, i, x.k, x.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)} aria-label={x.label} />}</td>)}
        <td className="pb-1.5">{editable && <Button variant="ghost" size="icon" onClick={() => setC((s: any) => ({ ...s, [list]: s[list].filter((_: any, j: number) => j !== i) }))} aria-label="Remove row"><Trash2 className="h-4 w-4" /></Button>}</td></tr>)}</tbody></table>
      {editable && <Button size="sm" variant="subtle" onClick={() => setC((s: any) => ({ ...s, [list]: [...(s[list] ?? []), blank] }))}><Plus className="h-3.5 w-3.5" />Add row</Button>}</div>
  );

  const save = async () => { setBusy('save'); try { await api(`/ai/jobs/${id}/corrections`, { method: 'PUT', body: { corrected: c } }); toast.success('Corrections saved and re-validated'); await refetch(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); } };
  const doCommit = async () => { setBusy('commit'); try { await api(`/ai/jobs/${id}/commit`, { body: isBmr ? { deductStock: opts.deductStock, finishedGoodsWarehouseId: opts.warehouseId || undefined } : { autoReceive: opts.autoReceive, warehouseId: opts.warehouseId || undefined } }); toast.success(isBmr ? 'Batch record created' : 'Invoice saved'); qc.invalidateQueries({ queryKey: ['/ai/jobs'] }); router.push(isBmr ? '/batches' : '/purchase'); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); } };
  const report = job.validation?.report; const match = job.validation?.match;
  const findings: any[] = isBmr ? report?.findings ?? [] : match?.flags ?? [];

  return (
    <>
      <PageHeader title={<>Review · {job.document.fileName}</>} description={<span className="inline-flex flex-wrap items-center gap-2"><StatusBadge status={job.status} />{isBmr ? 'Batch manufacturing record' : 'Supplier invoice'}{job.confidence && <span>· extraction confidence <b className="num">{Math.round(Number(job.confidence) * 100)}%</b></span>}{job.validation?.engine && <span className="text-xs text-muted-foreground">via {job.validation.engine}</span>}</span>}
        actions={editable ? <><Button variant="outline" onClick={() => api(`/ai/jobs/${id}/reprocess`, { method: 'POST' }).then(() => refetch())}><RefreshCw className="h-4 w-4" />Re-extract</Button><Button variant="outline" onClick={async () => { await api(`/ai/jobs/${id}/reject`, { method: 'POST' }); router.push('/ai/documents'); }}>Discard</Button><Button variant="outline" loading={busy === 'save'} onClick={save}>Save & re-validate</Button><Button loading={busy === 'commit'} onClick={() => setCommit(true)}>{isBmr ? 'Create batch record' : 'Save invoice'}</Button></> : null} />
      {job.error && <p className="mb-4 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{job.error}</p>}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <Panel title="Original document" flush className="xl:sticky xl:top-20 xl:self-start">{preview ? (job.document.mimeType === 'application/pdf' ? <iframe src={preview} title="Original document" className="h-[75vh] w-full" /> : <img src={preview} alt="Original document" className="max-h-[75vh] w-full object-contain" />) : <Skeleton className="h-96" />}</Panel>
        {c && <div className="space-y-4">
          {findings.length > 0 && <Panel title={isBmr ? `Validation · score ${report?.score}/100` : 'Match & risk findings'} action={isBmr && report && <StatusBadge status={report.verdict} />}><ul className="max-h-56 divide-y overflow-auto rounded border">{findings.map((f, i) => <li key={i} className="flex gap-2.5 px-3 py-1.5 text-[0.8125rem]"><StatusBadge status={f.severity} className="h-fit shrink-0" /><span>{f.message}</span></li>)}</ul></Panel>}
          {isBmr ? (<>
            <Panel title="Batch details"><div className="grid gap-3 sm:grid-cols-2"><F label="Batch number" path="batchNumber" /><Sel label="Product" path="productId" options={products} /><F label="Product name (as written)" path="productName" /><F label="Formula version" path="formulaVersion" /><F label="Manufacturing date" path="manufacturingDate" type="date" /><F label="Expiry date" path="expiryDate" type="date" /><F label="Batch size" path="batchSize.value" type="number" conf="batchSize" /><F label="Unit" path="batchSize.unit" conf="batchSize" /><Sel label="Operator" path="operatorId" options={users} /><F label="Operator (as written)" path="operatorName" />
              <div><label className="field-label" htmlFor="qcs">QC status</label><Select id="qcs" disabled={!editable} value={c.qcStatus ?? 'UNKNOWN'} onChange={(e) => setC((x: any) => ({ ...x, qcStatus: e.target.value }))}>{['PASSED', 'FAILED', 'PENDING', 'UNKNOWN'].map((s) => <option key={s}>{s}</option>)}</Select></div></div></Panel>
            <Panel title="Yield"><div className="grid gap-3 sm:grid-cols-3"><F label="Theoretical" path="yield.theoretical" type="number" conf="yield" /><F label="Actual" path="yield.actual" type="number" conf="yield" /><F label="Yield %" path="yield.percent" type="number" conf="yield" /></div></Panel>
            <Panel title="Ingredients (master formula section)"><Rows list="ingredients" blank={{ name: '', quantity: null, unit: 'KG', rawMaterialId: null }} cols={[{ k: 'name', label: 'Name (as written)' }, { k: 'rawMaterialId', label: 'Mapped material', mat: true, w: 'min-w-[12rem]' }, { k: 'quantity', label: 'Qty', type: 'number', w: 'w-24' }, { k: 'unit', label: 'Unit', w: 'w-20' }]} /></Panel>
            <Panel title="Material consumption (actuals)"><Rows list="materialConsumption" blank={{ name: '', actualQty: null, unit: 'KG', rawMaterialId: null }} cols={[{ k: 'name', label: 'Name' }, { k: 'rawMaterialId', label: 'Mapped material', mat: true, w: 'min-w-[12rem]' }, { k: 'plannedQty', label: 'Planned', type: 'number', w: 'w-24' }, { k: 'actualQty', label: 'Actual', type: 'number', w: 'w-24' }, { k: 'unit', label: 'Unit', w: 'w-20' }, { k: 'lotNumber', label: 'Lot', w: 'w-28' }]} /></Panel>
          </>) : (<>
            <Panel title="Invoice header"><div className="grid gap-3 sm:grid-cols-2"><F label="Invoice number" path="invoiceNumber" /><F label="Invoice date" path="invoiceDate" type="date" /><Sel label="Supplier (master)" path="supplierId" options={suppliers} /><F label="Supplier name (as written)" path="supplierName" /><F label="Supplier GSTIN" path="supplierGstin" /><Sel label="Purchase order" path="poId" options={pos} /><F label="Subtotal" path="subtotal" type="number" /><F label="Tax total" path="tax.total" type="number" /><F label="Grand total" path="total" type="number" /></div>{!c.supplierId && <p className="mt-2 text-xs text-warning">Supplier not matched — a new unapproved supplier will be created on save.</p>}</Panel>
            <Panel title="Line items"><Rows list="items" blank={{ description: '', quantity: null, unitPrice: null, amount: null, rawMaterialId: null }} cols={[{ k: 'description', label: 'Description' }, { k: 'rawMaterialId', label: 'Raw material', mat: true, w: 'min-w-[12rem]' }, { k: 'quantity', label: 'Qty', type: 'number', w: 'w-20' }, { k: 'unit', label: 'Unit', w: 'w-16' }, { k: 'unitPrice', label: 'Rate', type: 'number', w: 'w-24' }, { k: 'taxPct', label: 'GST %', type: 'number', w: 'w-16' }, { k: 'amount', label: 'Amount', type: 'number', w: 'w-28' }]} /><p className="mt-2 text-xs text-muted-foreground">Computed total {fmtMoney2((c.items ?? []).reduce((s: number, i: any) => s + Number(i.amount ?? 0), 0))}</p></Panel>
          </>)}
        </div>}
      </div>

      <Dialog open={commit} onOpenChange={setCommit}><DialogContent title={isBmr ? 'Create batch record' : 'Save invoice'} description="Everything above will be saved to the database and linked to the original document.">
        <div className="space-y-3 text-sm">
          {isBmr ? <><label className="flex items-start gap-2"><input type="checkbox" className="mt-1 accent-[hsl(var(--primary))]" checked={opts.deductStock} onChange={(e) => setOpts({ ...opts, deductStock: e.target.checked })} /><span><b>Deduct consumed materials from stock</b><br /><span className="text-muted-foreground">Leave off for historic records — materials were already consumed and booked. Turn on only for a live batch whose materials are still in the system.</span></span></label>
            <div><label className="field-label">Add finished goods to warehouse (optional)</label><Select value={opts.warehouseId} onChange={(e) => setOpts({ ...opts, warehouseId: e.target.value })}><option value="">Do not create finished-goods stock</option>{warehouses.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div></>
          : <><label className="flex items-start gap-2"><input type="checkbox" className="mt-1 accent-[hsl(var(--primary))]" checked={opts.autoReceive} onChange={(e) => setOpts({ ...opts, autoReceive: e.target.checked })} /><span><b>Receive stock automatically</b><br /><span className="text-muted-foreground">Posts a GRN and puts lots in QC quarantine. Only happens if the invoice matches with no warnings and every line is mapped — otherwise it waits for approval.</span></span></label>
            {opts.autoReceive && <div><label className="field-label">Receiving warehouse</label><Select value={opts.warehouseId} onChange={(e) => setOpts({ ...opts, warehouseId: e.target.value })}><option value="">Select…</option>{warehouses.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>}</>}
          <div className="flex justify-end gap-2 pt-2"><Button variant="outline" onClick={() => setCommit(false)}>Cancel</Button><Button loading={busy === 'commit'} disabled={!isBmr && opts.autoReceive && !opts.warehouseId} onClick={doCommit}>Confirm & save</Button></div>
        </div></DialogContent></Dialog>
    </>
  );
}
