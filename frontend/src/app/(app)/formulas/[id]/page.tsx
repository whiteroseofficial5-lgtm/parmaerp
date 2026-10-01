'use client';
import { useQuery } from '@tanstack/react-query';
import { Check, GitBranch, Pencil, Send, X } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import * as React from 'react';
import { FormDialog, useAction } from '@/components/form-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { KV, PageHeader, Panel, Skeleton } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, fmtMoney, fmtMoney2, fmtNum, humanize } from '@/lib/utils';

export default function FormulaDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can, user } = useAuth();
  const act = useAction();
  const { data: f } = useQuery({ queryKey: ['/formulas', id], queryFn: () => api<any>(`/formulas/${id}`) });
  const [size, setSize] = React.useState('');
  const { data: cost } = useQuery({ queryKey: ['formula-cost', id, size], queryFn: () => api<any>(`/formulas/${id}/cost`, { query: { batchSize: size || undefined } }), enabled: !!f });
  const { data: siblings } = useQuery({ queryKey: ['/formulas', 'sib', f?.productId], enabled: !!f, queryFn: () => api<any>('/formulas', { query: { productId: f.productId, pageSize: 50 } }) });
  const [dlg, setDlg] = React.useState<'reject' | 'version' | null>(null);
  const [diffTo, setDiffTo] = React.useState('');
  const { data: diff } = useQuery({ queryKey: ['diff', id, diffTo], enabled: !!diffTo, queryFn: () => api<any>('/formulas/diff', { query: { from: id, to: diffTo } }) });
  if (!f) return <Skeleton className="h-64" />;

  const who = (uid?: string) => f.users.find((u: any) => u.id === uid)?.name ?? '—';
  const inv = ['/formulas', 'formula-cost'];
  const canApprove = can('formula:approve') && f.status === 'PENDING_APPROVAL';
  const sod = f.createdById === user?.id && user?.role !== 'SUPER_ADMIN';

  return (
    <>
      <PageHeader
        title={<>{f.product.name} <span className="text-muted-foreground">{f.product.strength}</span> <span className="num ml-1 text-muted-foreground">v{f.version}</span></>}
        description={<span className="inline-flex items-center gap-2"><StatusBadge status={f.status} /> Prepared by {who(f.createdById)}{f.approvedById && <> · approved by {who(f.approvedById)}</>}</span>}
        actions={<>
          {['DRAFT', 'REJECTED'].includes(f.status) && can('formula:update') && <Button variant="outline" onClick={() => router.push(`/formulas/${id}/edit`)}><Pencil className="h-4 w-4" />Edit</Button>}
          {['DRAFT', 'REJECTED'].includes(f.status) && can('formula:submit') && <Button onClick={() => act(() => api(`/formulas/${id}/submit`, { method: 'POST' }), { ok: 'Submitted for approval', invalidate: inv })}><Send className="h-4 w-4" />Submit for approval</Button>}
          {canApprove && <Button variant="success" disabled={sod} title={sod ? 'Segregation of duties: you authored this version' : undefined} onClick={() => act(() => api(`/formulas/${id}/approve`, { method: 'POST', body: {} }), { ok: 'Formula approved', invalidate: inv })}><Check className="h-4 w-4" />Approve</Button>}
          {canApprove && <Button variant="danger" onClick={() => setDlg('reject')}><X className="h-4 w-4" />Reject</Button>}
          {['APPROVED', 'OBSOLETE'].includes(f.status) && can('formula:create') && <Button variant="outline" onClick={() => setDlg('version')}><GitBranch className="h-4 w-4" />New version</Button>}
        </>} />

      <Tabs defaultValue="bom">
        <TabsList><TabsTrigger value="bom">Ingredients & cost</TabsTrigger><TabsTrigger value="instr">Instructions</TabsTrigger><TabsTrigger value="hist">History</TabsTrigger><TabsTrigger value="ver">Versions</TabsTrigger></TabsList>
        <TabsContent value="bom">
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div><Label htmlFor="sz">Batch size ({f.baseBatchUnit})</Label><Input id="sz" type="number" className="w-40 num" placeholder={String(Number(f.baseBatchSize))} value={size} onChange={(e) => setSize(e.target.value)} /></div>
            <p className="pb-2 text-sm text-muted-foreground">Requirements, cost and stock availability recalculate for the size entered.</p>
          </div>
          {cost && (
            <>
              <div className="mb-4 grid grid-cols-2 divide-x rounded-lg border bg-card sm:grid-cols-5">
                {([['Material cost', fmtMoney(cost.materialCost)], ['Cost / unit', fmtMoney2(cost.costPerUnit)], ['Expected output', `${fmtNum(cost.expectedOutput, 0)} ${cost.batchUnit}`], ['Expected yield / wastage', `${fmtNum(cost.expectedYieldPct, 1)}% / ${fmtNum(cost.expectedWastagePct, 1)}%`], ['Stock check', cost.canManufacture ? 'Sufficient' : 'Shortage']] as const).map(([k, v]) => <div key={k} className="px-4 py-3"><div className="text-xs text-muted-foreground">{k}</div><div className={`num mt-0.5 text-lg font-semibold ${k === 'Stock check' ? (cost.canManufacture ? 'text-success' : 'text-danger') : ''}`}>{v}</div></div>)}
              </div>
              <Panel flush><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr>{['Material', 'Stage', 'Base qty', 'Wastage', 'Required', 'In stock UOM', 'Unit cost', 'Line cost', 'Usable stock', 'Shortage'].map((h, i) => <th key={h} className={`whitespace-nowrap px-3 py-2 font-semibold ${i > 1 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                <tbody>{cost.lines.map((l: any) => <tr key={l.rawMaterialId} className="border-t"><td className="px-3 py-2"><span className="id-text mr-2 text-muted-foreground">{l.code}</span>{l.name}</td><td className="px-3 py-2 text-muted-foreground">{l.stage ?? '—'}</td><td className="px-3 py-2 text-right num">{fmtNum(l.baseQty, 3)} {l.formulaUnit}</td><td className="px-3 py-2 text-right num">{fmtNum(l.wastagePct, 1)}%</td><td className="px-3 py-2 text-right num">{fmtNum(l.requiredQty, 3)} {l.formulaUnit}</td><td className="px-3 py-2 text-right num">{fmtNum(l.requiredInStockUom, 3)} {l.stockUom}</td><td className="px-3 py-2 text-right num">{fmtMoney2(l.unitCost)}</td><td className="px-3 py-2 text-right num font-medium">{fmtMoney2(l.lineCost)}</td><td className="px-3 py-2 text-right num">{fmtNum(l.availableStock, 2)}</td><td className={`px-3 py-2 text-right num ${Number(l.shortage) > 0 ? 'font-medium text-danger' : 'text-muted-foreground'}`}>{Number(l.shortage) > 0 ? fmtNum(l.shortage, 2) : '—'}</td></tr>)}</tbody></table></div></Panel>
            </>
          )}
        </TabsContent>
        <TabsContent value="instr"><Panel><KV cols={3} items={[['Base batch', `${fmtNum(f.baseBatchSize, 0)} ${f.baseBatchUnit}`], ['Expected yield', `${fmtNum(f.expectedYieldPct, 1)}%`], ['Effective from', fmtDateTime(f.effectiveFrom)]]} /><hr className="my-4" /><p className="whitespace-pre-wrap text-sm leading-relaxed">{f.instructions || 'No instructions recorded.'}</p>{f.changeReason && <p className="mt-4 text-sm"><span className="text-muted-foreground">Reason for this version: </span>{f.changeReason}</p>}</Panel></TabsContent>
        <TabsContent value="hist"><Panel><ol className="space-y-4 border-l pl-5">{f.history.map((h: any) => <li key={h.id} className="relative"><span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" /><div className="text-sm font-medium">{humanize(h.action)} <span className="font-normal text-muted-foreground">by {who(h.userId)}</span></div><div className="text-xs text-muted-foreground">{fmtDateTime(h.createdAt)}</div>{h.remarks && <p className="mt-0.5 text-sm">{h.remarks}</p>}</li>)}</ol></Panel></TabsContent>
        <TabsContent value="ver">
          <Panel flush><table className="w-full text-sm"><thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Version</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Reason</th><th className="px-3 py-2" /></tr></thead>
            <tbody>{siblings?.data?.map((v: any) => <tr key={v.id} className="border-t"><td className="px-3 py-2 num">v{v.version}{v.id === id && <span className="ml-2 text-xs text-muted-foreground">(this)</span>}</td><td className="px-3 py-2"><StatusBadge status={v.status} /></td><td className="px-3 py-2 text-muted-foreground">{v.changeReason ?? '—'}</td><td className="px-3 py-2 text-right space-x-2">{v.id !== id && <Button size="sm" variant="ghost" onClick={() => setDiffTo(v.id)}>Compare with this</Button>}{v.id !== id && <Button size="sm" variant="ghost" onClick={() => router.push(`/formulas/${v.id}`)}>Open</Button>}</td></tr>)}</tbody></table></Panel>
          {diff && <Panel title={`Changes v${diff.from} → v${diff.to}`} className="mt-4">{diff.changes.length ? <ul className="space-y-1.5 text-sm">{diff.changes.map((c: any, i: number) => <li key={i}><StatusBadge status={c.type === 'ADDED' ? 'APPROVED' : c.type === 'REMOVED' ? 'REJECTED' : 'PENDING'} className="mr-2" />{c.material}: <span className="num text-muted-foreground">{c.from ?? '—'}</span> → <span className="num">{c.to ?? 'removed'}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">No ingredient differences.</p>}</Panel>}
        </TabsContent>
      </Tabs>

      <FormDialog title="Reject formula" open={dlg === 'reject'} onOpenChange={(o) => !o && setDlg(null)} invalidate={inv} fields={[{ name: 'remarks', label: 'Reason for rejection', type: 'textarea', required: true }]} onSubmit={(v) => api(`/formulas/${id}/reject`, { body: v })} submitLabel="Reject formula" />
      <FormDialog title="Create new version" description="Copies this formula into a new draft for change control." open={dlg === 'version'} onOpenChange={(o) => !o && setDlg(null)} fields={[{ name: 'changeReason', label: 'Reason for change', type: 'textarea', required: true }]} onSubmit={async (v) => { const n = await api<any>(`/formulas/${id}/new-version`, { body: v }); router.push(`/formulas/${n.id}/edit`); }} submitLabel="Create draft" />
    </>
  );
}
