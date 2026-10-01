'use client';
import { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { DataTable } from '@/components/data-table';
import { FormDialog } from '@/components/form-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtNum, humanize } from '@/lib/utils';

export default function Batches() {
  const router = useRouter();
  const { can } = useAuth();
  const [open, setOpen] = React.useState(false);
  const cols: ColumnDef<any>[] = [
    { header: 'Batch', accessorKey: 'batchNumber', cell: (c) => <span className="id-text font-medium">{c.getValue() as string}</span> },
    { header: 'Product', id: 'p', accessorFn: (r) => r.product.name, cell: ({ row: { original: r } }) => <span>{r.product.name} <span className="text-muted-foreground">{r.product.strength}</span></span> },
    { header: 'Mfg', accessorKey: 'mfgDate', cell: (c) => <span className="num">{fmtDate(c.getValue() as string)}</span> },
    { header: 'Expiry', accessorKey: 'expiryDate', cell: (c) => <span className="num text-muted-foreground">{fmtDate(c.getValue() as string)}</span> },
    { header: 'Size', accessorFn: (r) => Number(r.batchSize), cell: ({ row: { original: r } }) => <span className="num">{fmtNum(r.batchSize, 0)} {r.batchUnit}</span> },
    { header: 'Yield', accessorFn: (r) => Number(r.yieldPct ?? 0), cell: ({ row: { original: r } }) => <span className="num">{r.yieldPct ? `${fmtNum(r.yieldPct, 1)}%` : '—'}</span> },
    { header: 'Status', accessorKey: 'status', cell: (c) => <StatusBadge status={c.getValue() as string} /> },
    { header: 'QC', accessorKey: 'qcStatus', cell: (c) => <StatusBadge status={c.getValue() as string} /> },
    { header: 'Source', accessorKey: 'source', cell: (c) => (c.getValue() === 'AI_IMPORT' ? <span className="rounded bg-tint px-1.5 py-0.5 text-xs text-primary">Scanned</span> : <span className="text-muted-foreground">System</span>) },
  ];
  return (
    <>
      <PageHeader title="Batch manufacturing records" description="Draft → Approved → In production → QC review → Released. Raw materials are deducted first-expiry-first-out when production starts." />
      <DataTable endpoint="/batches" columns={cols} search="Search batch or product…" onRowClick={(r) => router.push(`/batches/${r.id}`)}
        filters={[{ key: 'status', label: 'Status', options: ['DRAFT', 'APPROVED', 'IN_PRODUCTION', 'QC_REVIEW', 'RELEASED', 'REJECTED', 'CANCELLED'].map((v) => ({ value: v, label: humanize(v) })) }, { key: 'qcStatus', label: 'QC', options: ['PENDING', 'IN_TESTING', 'PASSED', 'FAILED'].map((v) => ({ value: v, label: humanize(v) })) }]}
        toolbar={can('batch:create') && <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" />New batch</Button>} />
      <FormDialog title="New batch record" description="Uses the currently approved formula. Required materials are calculated automatically." open={open} onOpenChange={setOpen} invalidate={['/batches']}
        fields={[{ name: 'productId', label: 'Product', type: 'select', required: true, optionsFrom: { endpoint: '/products', label: (r) => `${r.code} · ${r.name} ${r.strength ?? ''}` } }, { name: 'batchSize', label: 'Batch size', type: 'number', required: true, half: true }, { name: 'mfgDate', label: 'Manufacturing date', type: 'date', half: true }, { name: 'operatorId', label: 'Operator', type: 'select', optionsFrom: { endpoint: '/users/lookup', label: (r) => r.name } }, { name: 'remarks', label: 'Remarks', type: 'textarea' }]}
        onSubmit={async (v) => { const b = await api<any>('/batches', { body: v }); router.push(`/batches/${b.id}`); }} submitLabel="Create batch" />
    </>
  );
}
