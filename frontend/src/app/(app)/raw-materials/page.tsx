'use client';
import { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { DataTable } from '@/components/data-table';
import { FormDialog } from '@/components/form-dialog';
import { MATERIAL_FIELDS } from '@/components/material-fields';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtMoney2, fmtNum } from '@/lib/utils';

export default function RawMaterials() {
  const router = useRouter();
  const { can } = useAuth();
  const [open, setOpen] = React.useState(false);

  const columns: ColumnDef<any>[] = [
    { header: 'Code', accessorKey: 'code', cell: (c) => <span className="id-text">{c.getValue() as string}</span> },
    { header: 'Material', accessorKey: 'name', cell: (c) => <span className="font-medium">{c.getValue() as string}</span> },
    { header: 'Category', accessorKey: 'category', cell: (c) => <StatusBadge status={c.getValue() as string} className="!bg-muted !text-foreground/80" /> },
    { header: 'Usable', accessorFn: (r) => Number(r.usableStock), cell: ({ row: { original: r } }) => <span className="num">{fmtNum(r.usableStock, 2)} <span className="text-muted-foreground">{r.uom}</span></span> },
    { header: 'Quarantine', accessorFn: (r) => Number(r.quarantineStock), cell: ({ row: { original: r } }) => <span className="num text-muted-foreground">{Number(r.quarantineStock) ? fmtNum(r.quarantineStock, 2) : '—'}</span> },
    { header: 'Min / reorder', id: 'lv', cell: ({ row: { original: r } }) => <span className="num text-muted-foreground">{fmtNum(r.minStock, 0)} / {fmtNum(r.reorderLevel, 0)}</span> },
    { header: 'Stock', accessorKey: 'stockState', cell: (c) => <StatusBadge status={c.getValue() as string} /> },
    { header: 'Price', accessorFn: (r) => Number(r.purchasePrice), cell: (c) => <span className="num">{fmtMoney2(c.getValue())}</span> },
    { header: 'Supplier', id: 'sup', accessorFn: (r) => r.defaultSupplier?.name ?? '—', cell: (c) => <span className="text-muted-foreground">{c.getValue() as string}</span> },
  ];

  return (
    <>
      <PageHeader title="Raw materials" description="Material master with live usable, quarantined and expired stock." />
      <DataTable endpoint="/raw-materials" columns={columns} search="Search code or name…" onRowClick={(r) => router.push(`/raw-materials/${r.id}`)}
        filters={[
          { key: 'category', label: 'Category', options: ['API', 'EXCIPIENT', 'COATING', 'SOLVENT', 'PACKAGING', 'OTHER'].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() })) },
          { key: 'state', label: 'Stock', options: [{ value: 'OK', label: 'OK' }, { value: 'REORDER', label: 'Reorder' }, { value: 'CRITICAL', label: 'Critical' }, { value: 'OUT_OF_STOCK', label: 'Out of stock' }] },
        ]}
        toolbar={can('material:create') && <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" />New material</Button>} />
      <FormDialog title="New raw material" fields={MATERIAL_FIELDS} open={open} onOpenChange={setOpen} wide invalidate={['/raw-materials']} onSubmit={(v) => api('/raw-materials', { body: v })} />
    </>
  );
}
