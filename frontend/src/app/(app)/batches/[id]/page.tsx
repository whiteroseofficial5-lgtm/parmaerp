'use client';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Ban, Check, FileText, Play, ShieldCheck, Truck, X } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import { FormDialog, useAction } from '@/components/form-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { KV, PageHeader, Panel, Skeleton } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, blobUrl, openFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, fmtDate, fmtDateTime, fmtMoney, fmtMoney2, fmtNum, humanize } from '@/lib/utils';

const RAIL = ['DRAFT', 'APPROVED', 'IN_PRODUCTION', 'QC_REVIEW', 'RELEASED'] as const;

/** The batch lifecycle as a signed rail: each completed step shows when it happened. */
function Rail({ status, history }: { status: string; history: any[] }) {
  const at = (s: string) => history.find((h) => h.toStatus === s)?.createdAt;
  const idx = RAIL.indexOf(status as any);
  const terminal = idx === -1;
  return (
    <ol className="mb-5 grid grid-cols-5 rounded-lg border bg-card" aria-label="Batch lifecycle">
      {RAIL.map((s, i) => {
        const done = !terminal && i < idx || status === 'RELEASED', current = !terminal && i === idx && status !== 'RELEASED';
        return (
          <li key={s} className={cn('relative px-3 py-3', i > 0 && 'border-l')} aria-current={current ? 'step' : undefined}>
            <div className="flex items-center gap-2">
              <span className={cn('flex h-5 w-5 items-center justify-center rounded-full border text-[0.6875rem]', done ? 'border-primary bg-primary text-primary-foreground' : current ? 'border-primary text-primary ring-2 ring-primary/25' : 'text-muted-foreground')}>{done ? <Check className="h-3 w-3" /> : i + 1}</span>
              <span className={cn('text-[0.8125rem] font-medium', !done && !current && 'text-muted-foreground')}>{humanize(s)}</span>
            </div>
            <div className="num mt-1 pl-7 text-xs text-muted-foreground">{at(s) ? fmtDateTime(at(s)) : current ? 'In progress' : ''}</div>
            <div className={cn('absolute inset-x-0 bottom-0 h-0.5', done || current ? 'bg-primary' : 'bg-transparent')} />
          </li>
        );
      })}
    </ol>
  );
}

export default function BatchDetail() {
  const { id } = useParams<{ id: string }>();
  const { can, user } = useAuth();
  const act = useAction();
  const { data: b } = useQuery({ queryKey: ['/batches', id], queryFn: () => api<any>(`/batches/${id}`) });
  const [dlg, setDlg] = React.useState<'complete' | 'reject' | 'recall' | null>(null);
  const [qr, setQr] = React.useState<string>();
  const [val, setVal] = React.useState<any>(null);
  const [valBusy, setValBusy] = React.useState(false);
  React.useEffect(() => { if (b) blobUrl(`/batches/${id}/qr`).then(setQr).catch(() => undefined); }, [b?.id, id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!b) return <Skeleton className="h-72" />;

  const post = (path: string, ok: string, body?: object) => act(() => api(`/batches/${id}/${path}`, { method: 'POST', body: body ?? {} }), { ok, invalidate: ['/batches', 'dashboard'] });
  const sod = b.createdById === user?.id && user?.role !== 'SUPER_ADMIN';
  const s = b.status;
  const runValidation = async () => { setValBusy(true); try { setVal(await api(`/batches/${id}/validate`)); } catch (e) { toast.error((e as Error).message); } finally { setValBusy(false); } };

  return (
    <>
      <PageHeader
        title={<><span className="id-text mr-2">{b.batchNumber}</span>{b.product.name} <span className="text-muted-foreground">{b.product.strength}</span></>}
        description={<span className="inline-flex flex-wrap items-center gap-2"><StatusBadge status={s} /> QC <StatusBadge status={b.qcStatus} />{b.source === 'AI_IMPORT' && <span className="rounded bg-tint px-1.5 py-0.5 text-xs text-primary">Imported from scanned BMR</span>}</span>}
        actions={<>
          {s === 'DRAFT' && can('batch:approve') && <Button disabled={sod} title={sod ? 'Segregation of duties: author cannot approve' : undefined} onClick={() => post('approve', 'Batch approved')}><Check className="h-4 w-4" />Approve</Button>}
          {s === 'APPROVED' && can('batch:start') && <Button onClick={() => post('start', 'Production started — materials issued (FEFO)')}><Play className="h-4 w-4" />Start production</Button>}
          {s === 'IN_PRODUCTION' && can('batch:complete') && <Button onClick={() => setDlg('complete')}><Check className="h-4 w-4" />Complete & send to QC</Button>}
          {s === 'QC_REVIEW' && can('batch:release') && <Button variant="success" disabled={b.qcStatus !== 'PASSED'} title={b.qcStatus !== 'PASSED' ? 'All QC samples must pass first' : undefined} onClick={() => post('release', 'Batch released')}><ShieldCheck className="h-4 w-4" />Release</Button>}
          {s === 'QC_REVIEW' && can('batch:reject') && <Button variant="danger" onClick={() => setDlg('reject')}><X className="h-4 w-4" />Reject</Button>}
          {['DRAFT', 'APPROVED'].includes(s) && can('batch:update') && <Button variant="outline" onClick={() => post('cancel', 'Batch cancelled')}><Ban className="h-4 w-4" />Cancel</Button>}
          {s === 'RELEASED' && can('expiry:recall') && <Button variant="outline" onClick={() => setDlg('recall')}><Truck className="h-4 w-4" />Initiate recall</Button>}
        </>} />
      <Rail status={s} history={b.history} />
      {['REJECTED', 'CANCELLED'].includes(s) && <p className="mb-4 flex items-center gap-2 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"><AlertTriangle className="h-4 w-4" />This batch was {s.toLowerCase()}. {b.history.at(-1)?.remarks}</p>}

      <div className="mb-5 grid grid-cols-2 divide-x rounded-lg border bg-card sm:grid-cols-6">
        {([['Batch size', `${fmtNum(b.batchSize, 0)} ${b.batchUnit}`], ['Mfg → Expiry', `${fmtDate(b.mfgDate)} → ${fmtDate(b.expiryDate)}`], ['Actual yield', b.actualYield ? `${fmtNum(b.actualYield, 0)} (${fmtNum(b.yieldPct, 1)}%)` : '—'], ['Wastage', b.wastagePct ? `${fmtNum(b.wastagePct, 1)}%` : '—'], ['Material cost', b.materialCost ? fmtMoney(b.materialCost) : '—'], ['Cost / unit', b.costPerUnit ? fmtMoney2(b.costPerUnit) : '—']] as const).map(([k, v]) => <div key={k} className="min-w-0 px-4 py-3"><div className="text-xs text-muted-foreground">{k}</div><div className="num mt-0.5 truncate text-[0.9375rem] font-semibold">{v}</div></div>)}
      </div>

      <Tabs defaultValue="materials">
        <TabsList><TabsTrigger value="materials">Materials & lots</TabsTrigger><TabsTrigger value="qc">Quality</TabsTrigger><TabsTrigger value="hist">History & signatures</TabsTrigger><TabsTrigger value="validate">Validation</TabsTrigger><TabsTrigger value="docs">Documents & QR</TabsTrigger></TabsList>

        <TabsContent value="materials">
          <Panel flush><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Material</th><th className="px-3 py-2 text-right">Required</th><th className="px-3 py-2 text-right">Issued</th><th className="px-3 py-2">Lots consumed (supplier lot, expiry)</th></tr></thead>
            <tbody>{b.materials.map((m: any) => <tr key={m.id} className="border-t align-top"><td className="px-3 py-2"><span className="id-text mr-2 text-muted-foreground">{m.rawMaterial.code}</span>{m.rawMaterial.name}</td><td className="px-3 py-2 text-right num">{fmtNum(m.requiredQty, 3)} {m.unit}</td><td className="px-3 py-2 text-right num">{Number(m.issuedQty) ? `${fmtNum(m.issuedQty, 3)} ${m.unit}` : '—'}</td>
              <td className="px-3 py-2">{m.consumptions.length ? <ul className="space-y-0.5">{m.consumptions.map((c: any) => <li key={c.id} className="text-[0.8125rem]"><span className="id-text">{c.materialLot.lotNumber}</span> <span className="num text-muted-foreground">· {fmtNum(c.quantity, 3)} {m.unit} · {c.materialLot.supplier?.name ?? 'n/a'} · exp {fmtDate(c.materialLot.expiryDate)}</span></li>)}</ul> : <span className="text-muted-foreground">{['DRAFT', 'APPROVED'].includes(s) ? 'Issued at production start' : 'Not recorded (imported record)'}</span>}</td></tr>)}</tbody></table></div></Panel>
        </TabsContent>

        <TabsContent value="qc">
          {b.qcSamples.length ? b.qcSamples.map((q: any) => (
            <Panel key={q.id} className="mb-3" title={<span><span className="id-text">{q.sampleNumber}</span> <StatusBadge status={q.status} className="ml-2" /></span>} action={<Link href={`/qc/${q.id}`} className="text-xs text-primary hover:underline">Open sample</Link>} flush>
              <table className="w-full text-sm"><thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Parameter</th><th className="px-3 py-2">Specification</th><th className="px-3 py-2">Result</th><th className="px-3 py-2">Verdict</th></tr></thead>
                <tbody>{q.results.map((r: any) => <tr key={r.id} className="border-t"><td className="px-3 py-2">{r.parameter}</td><td className="px-3 py-2 text-muted-foreground">{r.specification}</td><td className="px-3 py-2 num">{r.resultValue} {r.unit}</td><td className="px-3 py-2"><StatusBadge status={r.passed ? 'PASS' : 'FAIL'} /></td></tr>)}{!q.results.length && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Results not entered yet.</td></tr>}</tbody></table>
            </Panel>)) : <Panel><p className="text-sm text-muted-foreground">QC samples are created when production is completed.</p></Panel>}
        </TabsContent>

        <TabsContent value="hist">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Status history"><ol className="space-y-3 border-l pl-5">{b.history.map((h: any) => <li key={h.id} className="relative"><span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" /><div className="text-sm font-medium">{humanize(h.toStatus)}</div><div className="num text-xs text-muted-foreground">{fmtDateTime(h.createdAt)}</div>{h.remarks && <p className="text-sm">{h.remarks}</p>}</li>)}</ol></Panel>
            <Panel title="Electronic signatures" flush><table className="w-full text-sm"><thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Meaning</th><th className="px-3 py-2">Signed by</th><th className="px-3 py-2">When</th><th className="px-3 py-2">ID</th></tr></thead><tbody>{b.signatures.map((g: any) => <tr key={g.id} className="border-t"><td className="px-3 py-2">{g.meaning}</td><td className="px-3 py-2">{g.user.name}<div className="text-xs text-muted-foreground">{humanize(g.user.role)}</div></td><td className="px-3 py-2 num text-muted-foreground">{fmtDateTime(g.createdAt)}</td><td className="px-3 py-2 id-text text-muted-foreground">{g.hash.slice(0, 10)}</td></tr>)}</tbody></table></Panel>
          </div>
        </TabsContent>

        <TabsContent value="validate">
          <Panel title="Batch record validation" action={<div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => openFile(`/batches/${id}/validate`, { query: { format: 'pdf' } }).catch((e) => toast.error(e.message))}><FileText className="h-3.5 w-3.5" />PDF report</Button><Button size="sm" loading={valBusy} onClick={runValidation}>Run validation</Button></div>}>
            {!val ? <p className="text-sm text-muted-foreground">Checks missing fields, formula mismatch, quantity deviations, expiry logic, QC consistency and yield anomalies against this product&apos;s history.</p> : (
              <>
                <div className="mb-3 flex items-center gap-3"><span className="num text-3xl font-semibold">{val.score}</span><span className="text-sm text-muted-foreground">/ 100</span><StatusBadge status={val.verdict} /></div>
                {val.narrative && <p className="mb-3 rounded bg-tint px-3 py-2 text-sm">{val.narrative}</p>}
                {val.findings.length ? <ul className="divide-y rounded border">{val.findings.map((f: any, i: number) => <li key={i} className="flex gap-3 px-3 py-2 text-sm"><StatusBadge status={f.severity} className="h-fit" /><div><span className="id-text text-muted-foreground">{f.code}</span><div>{f.message}</div></div></li>)}</ul> : <p className="text-sm text-success">No issues found.</p>}
              </>)}
          </Panel>
        </TabsContent>

        <TabsContent value="docs">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Generate documents"><div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => openFile(`/batches/${id}/pdf/bmr`, { query: { save: true } }).catch((e) => toast.error(e.message))}><FileText className="h-4 w-4" />Batch manufacturing record (PDF)</Button>
              <Button variant="outline" onClick={() => openFile(`/batches/${id}/pdf/bpr`, { query: { save: true } }).catch((e) => toast.error(e.message))}><FileText className="h-4 w-4" />Batch packaging record (PDF)</Button></div>
              <p className="mt-3 text-xs text-muted-foreground">Generated PDFs carry the QR code, approval workflow and electronic signatures, and are filed in Documents.</p></Panel>
            <Panel title="Traceability QR"><div className="flex items-center gap-4">{qr && <img src={qr} alt={`QR code for batch ${b.batchNumber}`} className="h-32 w-32 rounded border p-1" />}<div className="text-sm"><p className="text-muted-foreground">Scanning opens the public trace page: product, dates, QC status, raw-material lot history and recall state.</p><Link href={`/trace/${encodeURIComponent(b.batchNumber)}`} target="_blank" className="mt-2 inline-block text-primary hover:underline">Open trace page</Link></div></div></Panel>
          </div>
        </TabsContent>
      </Tabs>

      <FormDialog title="Complete production" description="Record actual output. Finished goods enter quarantine until QC releases the batch." open={dlg === 'complete'} onOpenChange={(o) => !o && setDlg(null)} invalidate={['/batches']}
        fields={[{ name: 'actualYield', label: `Actual yield (${b.batchUnit})`, type: 'number', required: true, hint: `Theoretical: ${fmtNum(b.theoreticalYield, 0)}` }, { name: 'finishedGoodsWarehouseId', label: 'Finished goods warehouse', type: 'select', required: true, optionsFrom: { endpoint: '/warehouses', label: (r) => r.name } }, { name: 'remarks', label: 'Remarks', type: 'textarea' }]}
        onSubmit={(v) => api(`/batches/${id}/complete`, { body: v })} submitLabel="Complete" />
      <FormDialog title="Reject batch" open={dlg === 'reject'} onOpenChange={(o) => !o && setDlg(null)} invalidate={['/batches']} fields={[{ name: 'remarks', label: 'Reason', type: 'textarea', required: true }]} onSubmit={(v) => api(`/batches/${id}/reject`, { body: v })} submitLabel="Reject batch" />
      <FormDialog title="Initiate product recall" description="Locks remaining finished goods and identifies customers who received this batch." open={dlg === 'recall'} onOpenChange={(o) => !o && setDlg(null)} invalidate={['/expiry']}
        fields={[{ name: 'classification', label: 'Classification', type: 'select', required: true, defaultValue: 'CLASS_II', options: [{ value: 'CLASS_I', label: 'Class I — serious health risk' }, { value: 'CLASS_II', label: 'Class II — temporary / reversible' }, { value: 'CLASS_III', label: 'Class III — unlikely health risk' }] }, { name: 'reason', label: 'Reason', type: 'textarea', required: true, hint: 'Minimum 10 characters' }]}
        onSubmit={(v) => api('/expiry/recalls', { body: { batchId: id, ...v } })} submitLabel="Initiate recall" />
    </>
  );
}
