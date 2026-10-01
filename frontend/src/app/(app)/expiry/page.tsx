'use client';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { FormDialog, useAction } from '@/components/form-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { PageHeader, Panel } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtNum } from '@/lib/utils';

export default function Expiry() {
  const { can } = useAuth(); const act = useAction();
  const [days, setDays] = React.useState('90');
  const [recall, setRecall] = React.useState(false);
  const { data: d } = useQuery({ queryKey: ['/expiry', days], queryFn: () => api<any>('/expiry', { query: { days } }) });
  const { data: recalls } = useQuery({ queryKey: ['/expiry', 'recalls'], queryFn: () => api<any[]>('/expiry/recalls') });
  const s = d?.summary;
  const Tbl = ({ rows, kind, expired }: { rows: any[]; kind: 'rm' | 'fg'; expired?: boolean }) => (
    <Panel flush><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Item</th><th className="px-3 py-2">{kind === 'rm' ? 'Lot' : 'Batch'}</th><th className="px-3 py-2 text-right">Quantity</th><th className="px-3 py-2">Expiry</th>{!expired && <th className="px-3 py-2 text-right">Days left</th>}<th className="px-3 py-2">Status</th><th /></tr></thead>
      <tbody>{rows?.map((l) => <tr key={l.id} className="border-t"><td className="px-3 py-2">{kind === 'rm' ? l.rawMaterial.name : l.product.name}</td><td className="px-3 py-2 id-text">{kind === 'rm' ? l.lotNumber : l.batch.batchNumber}</td><td className="px-3 py-2 text-right num">{fmtNum(l.availableQty, 2)}</td><td className="px-3 py-2 num">{fmtDate(l.expiryDate)}</td>{!expired && <td className={`px-3 py-2 text-right num ${l.daysLeft <= 30 ? 'text-danger' : 'text-warning'}`}>{l.daysLeft}</td>}<td className="px-3 py-2"><StatusBadge status={l.status} /></td>
        <td className="px-3 py-2 text-right">{expired && kind === 'rm' && can('expiry:update') && <Button size="sm" variant="outline" onClick={() => act(() => api(`/expiry/write-off/${l.id}`, { method: 'POST', body: {} }), { ok: 'Lot written off', invalidate: ['/expiry'] })}>Write off</Button>}</td></tr>)}
        {!rows?.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Nothing to show.</td></tr>}</tbody></table></div></Panel>);
  return (
    <>
      <PageHeader title="Expiry & recalls" description="Near-expiry and expired stock across raw materials and finished goods, with recall support."
        actions={<><select className="h-9 rounded border border-input bg-card px-2 text-sm" value={days} onChange={(e) => setDays(e.target.value)} aria-label="Horizon"><option value="30">Next 30 days</option><option value="60">Next 60 days</option><option value="90">Next 90 days</option><option value="180">Next 180 days</option></select>{can('expiry:update') && <Button variant="outline" onClick={() => act(() => api('/expiry/sweep', { method: 'POST' }), { ok: 'Alert sweep completed', invalidate: ['notif-count'] })}>Run alert sweep</Button>}</>} />
      {s && <div className="mb-5 grid grid-cols-2 divide-x rounded-lg border bg-card sm:grid-cols-4">{([['Raw material near expiry', s.rawMaterialNearExpiry, 'text-warning'], ['Raw material expired', s.rawMaterialExpired, 'text-danger'], ['Finished goods near expiry', s.finishedGoodsNearExpiry, 'text-warning'], ['Finished goods expired', s.finishedGoodsExpired, 'text-danger']] as const).map(([k, v, c]) => <div key={k} className="px-4 py-3"><div className="text-xs text-muted-foreground">{k}</div><div className={`num mt-0.5 text-2xl font-semibold ${v ? c : ''}`}>{v}</div></div>)}</div>}
      <Tabs defaultValue="rm-near">
        <TabsList><TabsTrigger value="rm-near">Materials near expiry</TabsTrigger><TabsTrigger value="rm-exp">Materials expired</TabsTrigger><TabsTrigger value="fg-near">Products near expiry</TabsTrigger><TabsTrigger value="fg-exp">Products expired</TabsTrigger><TabsTrigger value="recalls">Recalls</TabsTrigger></TabsList>
        <TabsContent value="rm-near"><Tbl rows={d?.rawMaterialNearExpiry} kind="rm" /></TabsContent><TabsContent value="rm-exp"><Tbl rows={d?.rawMaterialExpired} kind="rm" expired /></TabsContent>
        <TabsContent value="fg-near"><Tbl rows={d?.finishedGoodsNearExpiry} kind="fg" /></TabsContent><TabsContent value="fg-exp"><Tbl rows={d?.finishedGoodsExpired} kind="fg" expired /></TabsContent>
        <TabsContent value="recalls"><Panel flush title="Product recalls" action={can('expiry:recall') && <Button size="sm" variant="danger" onClick={() => setRecall(true)}>Initiate recall</Button>}><table className="w-full text-sm"><thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr>{['Recall', 'Batch', 'Class', 'Reason', 'Dispatched', 'Recovered', 'Status', ''].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{recalls?.map((r) => <tr key={r.id} className="border-t"><td className="px-3 py-2 id-text">{r.recallNumber}</td><td className="px-3 py-2">{r.batch.product.name} · <span className="id-text">{r.batch.batchNumber}</span></td><td className="px-3 py-2">{r.classification.replace('_', ' ')}</td><td className="max-w-xs truncate px-3 py-2 text-muted-foreground">{r.reason}</td><td className="px-3 py-2 num">{fmtNum(r.quantityDispatched, 0)}</td><td className="px-3 py-2 num">{r.quantityRecovered ? fmtNum(r.quantityRecovered, 0) : '—'}</td><td className="px-3 py-2"><StatusBadge status={r.status} /></td>
            <td className="px-3 py-2 text-right">{r.status !== 'CLOSED' && can('expiry:recall') && <Button size="sm" variant="outline" onClick={() => { const q = window.prompt('Quantity recovered'); if (q) act(() => api(`/expiry/recalls/${r.id}/close`, { body: { quantityRecovered: Number(q) } }), { ok: 'Recall closed', invalidate: ['/expiry'] }); }}>Close</Button>}</td></tr>)}{!recalls?.length && <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No recalls.</td></tr>}</tbody></table></Panel></TabsContent>
      </Tabs>
      <FormDialog title="Initiate product recall" open={recall} onOpenChange={setRecall} invalidate={['/expiry']} fields={[{ name: 'batchId', label: 'Batch', type: 'select', required: true, optionsFrom: { endpoint: '/batches', query: { status: 'RELEASED' }, label: (r) => `${r.batchNumber} · ${r.product.name}` } }, { name: 'classification', label: 'Classification', type: 'select', required: true, defaultValue: 'CLASS_II', options: [{ value: 'CLASS_I', label: 'Class I' }, { value: 'CLASS_II', label: 'Class II' }, { value: 'CLASS_III', label: 'Class III' }] }, { name: 'reason', label: 'Reason', type: 'textarea', required: true }]} onSubmit={(v) => api('/expiry/recalls', { body: v })} submitLabel="Initiate recall" />
    </>
  );
}
