'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { FileScan, Receipt, UploadCloud } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { PageHeader, Spinner } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, fmtDateTime, humanize } from '@/lib/utils';

function Drop({ kind, title, hint, icon: Icon, disabled }: { kind: 'bmr' | 'invoice'; title: string; hint: string; icon: any; disabled: boolean }) {
  const qc = useQueryClient(); const [over, setOver] = React.useState(false); const [busy, setBusy] = React.useState(false); const input = React.useRef<HTMLInputElement>(null);
  const send = async (files: FileList | File[]) => {
    if (!files.length) return; setBusy(true);
    try { const fd = new FormData(); Array.from(files).forEach((f) => fd.append('files', f)); await api(`/ai/${kind}/upload`, { form: fd }); toast.success(`${files.length} file(s) queued — extraction runs in the background`); qc.invalidateQueries({ queryKey: ['/ai/jobs'] }); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) send(e.dataTransfer.files); }}
      className={cn('flex items-center gap-4 rounded-lg border-2 border-dashed bg-card p-5 transition-colors', over ? 'border-primary bg-tint' : 'border-input', disabled && 'opacity-50')}>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded bg-tint text-primary"><Icon className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{title}</div><p className="text-[0.8125rem] text-muted-foreground">{hint}</p></div>
      <input ref={input} type="file" multiple hidden accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => e.target.files && send(e.target.files)} />
      <button disabled={disabled || busy} onClick={() => input.current?.click()} className="inline-flex h-9 items-center gap-1.5 rounded bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">{busy ? <Spinner className="text-primary-foreground" /> : <UploadCloud className="h-4 w-4" />}Upload</button>
    </div>
  );
}

export default function DocumentAI() {
  const { can } = useAuth(); const router = useRouter();
  const { data: status } = useQuery({ queryKey: ['ai-status'], queryFn: () => api<{ engine: string; model: string | null }>('/ai/status') });
  const cols: ColumnDef<any>[] = [
    { header: 'Document', id: 'd', accessorFn: (r) => r.document.fileName, cell: (c) => <span className="font-medium">{c.getValue() as string}</span> },
    { header: 'Kind', accessorKey: 'kind', cell: (c) => (c.getValue() === 'BMR' ? 'Batch record' : 'Invoice') },
    { header: 'Status', accessorKey: 'status', cell: ({ row: { original: r } }) => <span className="inline-flex items-center gap-1.5"><StatusBadge status={r.status} />{['UPLOADED', 'PROCESSING'].includes(r.status) && <Spinner />}</span> },
    { header: 'Confidence', accessorFn: (r) => Number(r.confidence ?? 0), cell: ({ row: { original: r } }) => (r.confidence ? <span className={cn('num', Number(r.confidence) < 0.75 && 'text-warning')}>{Math.round(Number(r.confidence) * 100)}%</span> : <span className="text-muted-foreground">—</span>) },
    { header: 'Uploaded', accessorKey: 'createdAt', cell: (c) => <span className="num text-muted-foreground">{fmtDateTime(c.getValue() as string)}</span> },
    { header: 'Result', id: 'r', enableSorting: false, cell: ({ row: { original: r } }) => <span className="text-xs text-muted-foreground">{r.error ?? (r.createdBatchId ? 'Batch record created' : r.createdInvoiceId ? 'Invoice created' : '')}</span> },
  ];
  const [poll, setPoll] = React.useState(0);
  React.useEffect(() => { const t = setInterval(() => setPoll((p) => p + 1), 4000); return () => clearInterval(t); }, []);
  return (
    <>
      <PageHeader title="Document AI" description="Upload batch records, supplier invoices and bills — typed, scanned or handwritten. Extracted data is always reviewed by a person before anything is saved." />
      <p className="mb-4 rounded border bg-tint px-3 py-2 text-sm">Engine: <b>{status?.engine === 'claude-vision' ? `Claude vision (${status.model})` : status?.engine === 'tesseract-fallback' ? 'Local OCR fallback — header fields only. Set ANTHROPIC_API_KEY for full extraction incl. handwriting and line items.' : 'Not configured'}</b></p>
      <div className="mb-5 grid gap-3 lg:grid-cols-2">
        <Drop kind="bmr" title="Batch manufacturing records" hint="PDF, scan, photo or handwritten form. Multi-page supported." icon={FileScan} disabled={!can('ai:bmr')} />
        <Drop kind="invoice" title="Supplier invoices & GST bills" hint="Invoice PDFs, purchase bills, scans and photos of bills." icon={Receipt} disabled={!can('ai:invoice')} />
      </div>
      <DataTable endpoint="/ai/jobs" queryKey={[poll]} columns={cols} search={false} onRowClick={(r) => router.push(`/ai/documents/${r.id}`)} filters={[{ key: 'kind', label: 'Kind', options: [{ value: 'BMR', label: 'Batch record' }, { value: 'INVOICE', label: 'Invoice' }] }, { key: 'status', label: 'Status', options: ['PROCESSING', 'REVIEW', 'APPROVED', 'REJECTED', 'FAILED'].map((v) => ({ value: v, label: humanize(v) })) }]} emptyTitle="No documents yet" emptyHint="Upload a batch record or invoice to begin." />
    </>
  );
}
