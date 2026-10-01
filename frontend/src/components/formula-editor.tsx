'use client';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import { useOptions } from './form-dialog';
import { Button } from './ui/button';
import { Input, Label, Select, Textarea } from './ui/input';
import { PageHeader, Panel } from './ui/misc';
import { api } from '@/lib/api';

interface Row { rawMaterialId: string; quantity: string; unit: string; wastagePct: string; stage: string }
const blank = (): Row => ({ rawMaterialId: '', quantity: '', unit: 'KG', wastagePct: '0', stage: '' });
const UNITS = ['KG', 'G', 'MG', 'L', 'ML', 'NOS'];

export function FormulaEditor({ formulaId }: { formulaId?: string }) {
  const router = useRouter();
  const products = useOptions({ endpoint: '/products', label: (r) => `${r.code} · ${r.name} ${r.strength ?? ''}` });
  const { data: mats } = useQuery({ queryKey: ['mat-all'], queryFn: () => api<any>('/raw-materials', { query: { pageSize: 200 } }) });
  const { data: existing } = useQuery({ queryKey: ['/formulas', formulaId], enabled: !!formulaId, queryFn: () => api<any>(`/formulas/${formulaId}`) });

  const [f, setF] = React.useState({ productId: '', baseBatchSize: '100000', baseBatchUnit: 'TAB', expectedYieldPct: '98', instructions: '', changeReason: '' });
  const [rows, setRows] = React.useState<Row[]>([blank()]);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!existing) return;
    setF({ productId: existing.productId, baseBatchSize: String(Number(existing.baseBatchSize)), baseBatchUnit: existing.baseBatchUnit, expectedYieldPct: String(Number(existing.expectedYieldPct)), instructions: existing.instructions ?? '', changeReason: existing.changeReason ?? '' });
    setRows(existing.items.map((i: any) => ({ rawMaterialId: i.rawMaterialId, quantity: String(Number(i.quantity)), unit: i.unit, wastagePct: String(Number(i.wastagePct)), stage: i.stage ?? '' })));
  }, [existing]);

  const setRow = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const matById = new Map<string, any>((mats?.data ?? []).map((m: any) => [m.id, m]));

  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f, baseBatchSize: Number(f.baseBatchSize), expectedYieldPct: Number(f.expectedYieldPct), items: rows.filter((r) => r.rawMaterialId).map((r) => ({ rawMaterialId: r.rawMaterialId, quantity: Number(r.quantity), unit: r.unit, wastagePct: Number(r.wastagePct || 0), stage: r.stage || undefined })) };
      const res = formulaId ? await api<any>(`/formulas/${formulaId}`, { method: 'PATCH', body }) : await api<any>('/formulas', { body });
      toast.success(`Formula v${res.version} saved as draft`);
      router.push(`/formulas/${res.id}`);
    } catch (e: any) { toast.error(e.message + (e.details?.fieldErrors ? ' — ' + JSON.stringify(e.details.fieldErrors) : '')); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title={formulaId ? `Edit formula${existing ? ` v${existing.version}` : ''}` : 'New formula'} description="Quantities are per base batch size. Wastage % is added on top when the BOM is exploded." actions={<><Button variant="outline" onClick={() => router.back()}>Cancel</Button><Button loading={busy} onClick={save}>Save draft</Button></>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Product & batch basis" className="lg:col-span-1">
          <div className="space-y-3">
            <div><Label htmlFor="p">Product</Label><Select id="p" value={f.productId} disabled={!!formulaId} onChange={(e) => { const v = e.target.value; setF({ ...f, productId: v }); }}><option value="">Select product…</option>{products.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>
            <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="bs">Base batch size</Label><Input id="bs" type="number" value={f.baseBatchSize} onChange={(e) => setF({ ...f, baseBatchSize: e.target.value })} /></div><div><Label htmlFor="bu">Unit</Label><Input id="bu" value={f.baseBatchUnit} onChange={(e) => setF({ ...f, baseBatchUnit: e.target.value.toUpperCase() })} /></div></div>
            <div><Label htmlFor="y">Expected yield %</Label><Input id="y" type="number" step="0.1" value={f.expectedYieldPct} onChange={(e) => setF({ ...f, expectedYieldPct: e.target.value })} /></div>
            <div><Label htmlFor="cr">Reason for change</Label><Input id="cr" value={f.changeReason} onChange={(e) => setF({ ...f, changeReason: e.target.value })} placeholder="Required for change control on new versions" /></div>
          </div>
        </Panel>
        <Panel title="Manufacturing instructions" className="lg:col-span-2"><Textarea className="min-h-[190px]" value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} placeholder="Step-by-step process, critical parameters, in-process checks…" /></Panel>
      </div>
      <Panel title="Ingredients" className="mt-4" flush action={<Button size="sm" variant="subtle" onClick={() => setRows((r) => [...r, blank()])}><Plus className="h-3.5 w-3.5" />Add ingredient</Button>}>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Material</th><th className="w-28 px-3 py-2">Quantity</th><th className="w-24 px-3 py-2">Unit</th><th className="w-24 px-3 py-2">Wastage %</th><th className="w-40 px-3 py-2">Stage</th><th className="w-10" /></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i} className="border-t">
              <td className="px-3 py-1.5"><Select value={r.rawMaterialId} onChange={(e) => { const m = matById.get(e.target.value); setRow(i, { rawMaterialId: e.target.value, unit: m?.uom ?? r.unit }); }} aria-label="Material"><option value="">Select material…</option>{(mats?.data ?? []).map((m: any) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}</Select></td>
              <td className="px-3 py-1.5"><Input type="number" step="any" className="num" value={r.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })} aria-label="Quantity" /></td>
              <td className="px-3 py-1.5"><Select value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value })} aria-label="Unit">{UNITS.map((u) => <option key={u}>{u}</option>)}</Select></td>
              <td className="px-3 py-1.5"><Input type="number" step="0.1" className="num" value={r.wastagePct} onChange={(e) => setRow(i, { wastagePct: e.target.value })} aria-label="Wastage percent" /></td>
              <td className="px-3 py-1.5"><Input value={r.stage} onChange={(e) => setRow(i, { stage: e.target.value })} placeholder="e.g. Granulation" aria-label="Stage" /></td>
              <td className="px-2"><Button variant="ghost" size="icon" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label="Remove ingredient"><Trash2 className="h-4 w-4 text-muted-foreground" /></Button></td>
            </tr>))}</tbody></table></div>
      </Panel>
    </>
  );
}
