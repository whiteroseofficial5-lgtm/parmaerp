'use client';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { useParams } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import { useAction } from '@/components/form-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KV, PageHeader, Panel, Skeleton } from '@/components/ui/misc';
import { api, openFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, humanize } from '@/lib/utils';

interface R { parameter: string; specification: string; resultValue: string; lowerLimit: string; upperLimit: string; unit: string; passed: boolean | null }
const blank = (): R => ({ parameter: '', specification: '', resultValue: '', lowerLimit: '', upperLimit: '', unit: '', passed: null });

export default function Sample() {
  const { id } = useParams<{ id: string }>();
  const { can, user } = useAuth(); const act = useAction();
  const { data: s } = useQuery({ queryKey: ['/qc/samples', id], queryFn: () => api<any>(`/qc/samples/${id}`) });
  const { data: specs } = useQuery({ queryKey: ['qc-specs', id], queryFn: () => api<any[]>(`/qc/samples/${id}/specs`) });
  const [rows, setRows] = React.useState<R[]>([blank()]);
  React.useEffect(() => { if (s?.results?.length) setRows(s.results.map((r: any) => ({ parameter: r.parameter, specification: r.specification ?? '', resultValue: r.resultValue, lowerLimit: r.lowerLimit ?? '', upperLimit: r.upperLimit ?? '', unit: r.unit ?? '', passed: r.passed }))); }, [s]);
  if (!s) return <Skeleton className="h-64" />;

  const locked = ['PASSED', 'FAILED'].includes(s.status);
  const set = (i: number, p: Partial<R>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const prefill = () => specs?.length ? setRows(specs.map((sp) => ({ parameter: sp.testName, specification: sp.textSpec ?? [sp.lowerLimit != null && `≥ ${Number(sp.lowerLimit)}`, sp.upperLimit != null && `≤ ${Number(sp.upperLimit)}`].filter(Boolean).join(' and ') + (sp.unit ? ` ${sp.unit}` : ''), resultValue: '', lowerLimit: sp.lowerLimit != null ? String(Number(sp.lowerLimit)) : '', upperLimit: sp.upperLimit != null ? String(Number(sp.upperLimit)) : '', unit: sp.unit ?? '', passed: sp.textSpec ? true : null }))) : toast.info('No specifications defined for this item');
  const verdict = (r: R) => { const n = Number(r.resultValue); if (r.resultValue !== '' && !Number.isNaN(n) && (r.lowerLimit !== '' || r.upperLimit !== '')) return (r.lowerLimit === '' || n >= Number(r.lowerLimit)) && (r.upperLimit === '' || n <= Number(r.upperLimit)); return r.passed; };
  const save = () => act(() => api(`/qc/samples/${id}/results`, { method: 'PUT', body: { results: rows.filter((r) => r.parameter && r.resultValue).map((r) => { const n = Number(r.resultValue); return { parameter: r.parameter, specification: r.specification || undefined, resultValue: r.resultValue, numericValue: !Number.isNaN(n) && r.resultValue.trim() !== '' ? n : undefined, lowerLimit: r.lowerLimit !== '' ? Number(r.lowerLimit) : undefined, upperLimit: r.upperLimit !== '' ? Number(r.upperLimit) : undefined, unit: r.unit || undefined, passed: verdict(r) ?? undefined }; }) } }), { ok: 'Results saved', invalidate: ['/qc/samples'] });
  const subject = s.materialLot ? `${s.materialLot.rawMaterial.name} — lot ${s.materialLot.lotNumber}` : `${s.batch?.product.name} — batch ${s.batch?.batchNumber}`;
  const sod = s.analystId === user?.id && user?.role !== 'SUPER_ADMIN';

  return (
    <>
      <PageHeader title={<><span className="id-text mr-2">{s.sampleNumber}</span>{subject}</>} description={<span className="inline-flex items-center gap-2"><StatusBadge status={s.status} />{humanize(s.type)} · collected {fmtDateTime(s.collectedAt)}</span>}
        actions={<>
          <Button variant="outline" onClick={() => openFile(`/qc/samples/${id}/report`, { query: { coa: s.coa ? true : undefined } }).catch((e) => toast.error(e.message))}>{s.coa ? 'Certificate of analysis' : 'Test report'} (PDF)</Button>
          {!locked && can('qc:update') && <Button variant="outline" onClick={save}>Save results</Button>}
          {!locked && can('qc:update') && s.results.length > 0 && <Button disabled={sod} title={sod ? 'Segregation of duties: the analyst cannot review own results' : undefined} onClick={() => act(() => api(`/qc/samples/${id}/finalise`, { method: 'POST', body: {} }), { ok: 'Sample finalised — COA generated', invalidate: ['/qc/samples'] })}>Finalise & issue COA</Button>}
        </>} />
      <Panel title="Test results" className="mb-4" flush action={!locked && can('qc:update') && <div className="flex gap-2"><Button size="sm" variant="subtle" onClick={prefill}><Wand2 className="h-3.5 w-3.5" />Load specifications</Button><Button size="sm" variant="outline" onClick={() => setRows((r) => [...r, blank()])}><Plus className="h-3.5 w-3.5" />Add test</Button></div>}>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Parameter</th><th className="px-3 py-2">Specification</th><th className="w-28 px-3 py-2">Result</th><th className="w-20 px-3 py-2">Lower</th><th className="w-20 px-3 py-2">Upper</th><th className="w-20 px-3 py-2">Unit</th><th className="w-24 px-3 py-2">Verdict</th><th className="w-10" /></tr></thead>
          <tbody>{rows.map((r, i) => { const v = verdict(r); return (
            <tr key={i} className="border-t">
              <td className="px-3 py-1.5"><Input disabled={locked} value={r.parameter} onChange={(e) => set(i, { parameter: e.target.value })} aria-label="Parameter" /></td>
              <td className="px-3 py-1.5"><Input disabled={locked} value={r.specification} onChange={(e) => set(i, { specification: e.target.value })} aria-label="Specification" /></td>
              <td className="px-3 py-1.5"><Input disabled={locked} className="num" value={r.resultValue} onChange={(e) => set(i, { resultValue: e.target.value })} aria-label="Result" /></td>
              <td className="px-3 py-1.5"><Input disabled={locked} className="num" value={r.lowerLimit} onChange={(e) => set(i, { lowerLimit: e.target.value })} aria-label="Lower limit" /></td>
              <td className="px-3 py-1.5"><Input disabled={locked} className="num" value={r.upperLimit} onChange={(e) => set(i, { upperLimit: e.target.value })} aria-label="Upper limit" /></td>
              <td className="px-3 py-1.5"><Input disabled={locked} value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} aria-label="Unit" /></td>
              <td className="px-3 py-1.5">{r.lowerLimit === '' && r.upperLimit === '' && !locked ? <select className="h-9 rounded border border-input bg-card px-2 text-sm" value={r.passed === null ? '' : r.passed ? 'p' : 'f'} onChange={(e) => set(i, { passed: e.target.value === '' ? null : e.target.value === 'p' })} aria-label="Verdict"><option value="">—</option><option value="p">Pass</option><option value="f">Fail</option></select> : v === null ? <span className="text-muted-foreground">—</span> : <StatusBadge status={v ? 'PASS' : 'FAIL'} />}</td>
              <td>{!locked && <Button variant="ghost" size="icon" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label="Remove test"><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>}</td>
            </tr>); })}</tbody></table></div>
      </Panel>
      {s.remarks && <Panel title="Remarks"><p className="text-sm">{s.remarks}</p></Panel>}
    </>
  );
}
