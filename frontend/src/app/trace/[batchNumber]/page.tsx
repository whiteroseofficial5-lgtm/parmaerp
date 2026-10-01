'use client';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { StatusBadge } from '@/components/status-badge';
import { Skeleton } from '@/components/ui/misc';
import { fmtDate, fmtDateTime, fmtNum, humanize } from '@/lib/utils';

/** Public QR landing page — no login. Shows provenance, never cost or personnel data. */
export default function Trace() {
  const { batchNumber } = useParams<{ batchNumber: string }>();
  const { data: t, error, isLoading } = useQuery({ queryKey: ['trace', batchNumber], retry: false, queryFn: async () => { const r = await fetch(`/api/public/trace/${batchNumber}`); if (!r.ok) throw new Error((await r.json()).error ?? 'Not found'); return r.json(); } });
  if (isLoading) return <div className="mx-auto max-w-2xl p-6"><Skeleton className="h-64" /></div>;
  if (error || !t) return <div className="mx-auto max-w-md p-10 text-center"><h1 className="text-lg font-semibold">Batch not found</h1><p className="mt-1 text-sm text-muted-foreground">This code does not match a batch in our records. If the pack you scanned is genuine, please contact the manufacturer.</p></div>;
  const bad = t.recalled || t.isExpired || ['REJECTED', 'CANCELLED'].includes(t.status);
  const ok = t.status === 'RELEASED' && !bad;
  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <div className={`mb-5 rounded-lg border-l-4 p-4 ${ok ? 'border-success bg-success/10' : bad ? 'border-danger bg-danger/10' : 'border-warning bg-warning/10'}`}>
        <div className="text-sm font-semibold">{t.recalled ? 'This batch has been recalled — do not use.' : t.isExpired ? 'This batch has expired — do not use.' : ok ? 'Released by Quality Control' : `Batch status: ${humanize(t.status)}`}</div>
        {t.recalls?.[0] && <p className="mt-1 text-sm">{t.recalls[0].reason}</p>}
      </div>
      <h1 className="text-xl font-semibold">{t.product.name} <span className="text-muted-foreground">{t.product.strength}</span></h1>
      <p className="id-text mt-0.5 text-muted-foreground">Batch {t.batchNumber}</p>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-3">
        {([['Manufactured', fmtDate(t.mfgDate)], ['Expires', fmtDate(t.expiryDate)], ['Dosage form', t.product.dosageForm ?? '—'], ['Batch size', `${fmtNum(t.batchSize, 0)} ${t.batchUnit}`], ['QC result', <StatusBadge key="q" status={t.qcStatus} />], ['Released', fmtDate(t.releasedAt)]] as const).map(([k, v]) => <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>)}
      </dl>
      <h2 className="mb-2 mt-6 text-sm font-semibold">Raw material history</h2>
      <div className="overflow-hidden rounded-lg border bg-card"><table className="w-full text-sm"><thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Material</th><th className="px-3 py-2">Lot</th><th className="px-3 py-2">Supplier</th></tr></thead><tbody>{t.rawMaterialHistory.map((m: any) => m.lots.length ? m.lots.map((l: any, i: number) => <tr key={m.code + i} className="border-t"><td className="px-3 py-2">{i === 0 ? m.material : ''}</td><td className="px-3 py-2 id-text">{l.lotNumber}</td><td className="px-3 py-2 text-muted-foreground">{l.supplier ?? '—'}</td></tr>) : <tr key={m.code} className="border-t"><td className="px-3 py-2">{m.material}</td><td className="px-3 py-2 text-muted-foreground" colSpan={2}>Lot detail not recorded</td></tr>)}</tbody></table></div>
      <h2 className="mb-2 mt-6 text-sm font-semibold">Production & QC history</h2>
      <ol className="space-y-2 border-l pl-5">{t.productionHistory.map((h: any, i: number) => <li key={i} className="relative text-sm"><span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />{humanize(h.toStatus)} <span className="num text-xs text-muted-foreground">· {fmtDateTime(h.createdAt)}</span></li>)}{t.qcHistory.map((q: any) => <li key={q.sampleNumber} className="relative text-sm"><span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-success" />QC {humanize(q.type)} — {humanize(q.status)} <span className="id-text text-xs text-muted-foreground">{q.sampleNumber}</span></li>)}</ol>
    </div>
  );
}
