'use client';
import { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { DataTable } from '@/components/data-table';
import { FormDialog } from '@/components/form-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtMoney, fmtNum, humanize } from '@/lib/utils';

export default function Formulas() {
  const router = useRouter();
  const { can } = useAuth();
  const [prod, setProd] = React.useState(false);
  const cols: ColumnDef<any>[] = [
    { header: 'Product', id: 'p', accessorFn: (r) => r.product.name, cell: ({ row: { original: r } }) => <span><span className="id-text mr-2 text-muted-foreground">{r.product.code}</span><span className="font-medium">{r.product.name}</span> <span className="text-muted-foreground">{r.product.strength}</span></span> },
    { header: 'Version', accessorKey: 'version', cell: (c) => <span className="num">v{c.getValue() as number}</span> },
    { header: 'Status', accessorKey: 'status', cell: (c) => <StatusBadge status={c.getValue() as string} /> },
    { header: 'Ingredients', id: 'n', accessorFn: (r) => r._count.items, cell: (c) => <span className="num">{c.getValue() as number}</span> },
    { header: 'Base batch', id: 'b', accessorFn: (r) => Number(r.baseBatchSize), cell: ({ row: { original: r } }) => <span className="num">{fmtNum(r.baseBatchSize, 0)} {r.baseBatchUnit}</span> },
    { header: 'Std cost / batch', id: 'c', accessorFn: (r) => Number(r.standardCost ?? 0), cell: (c) => <span className="num">{c.getValue() ? fmtMoney(c.getValue()) : '—'}</span> },
    { header: 'Approved', accessorKey: 'approvedAt', cell: (c) => <span className="text-muted-foreground">{fmtDate(c.getValue() as string)}</span> },
  ];
  const pcols: ColumnDef<any>[] = [
    { header: 'Code', accessorKey: 'code', cell: (c) => <span className="id-text">{c.getValue() as string}</span> }, { header: 'Product', accessorKey: 'name' }, { header: 'Form', accessorKey: 'dosageForm' }, { header: 'Strength', accessorKey: 'strength' },
    { header: 'Pack', accessorKey: 'packSize' }, { header: 'Shelf life', accessorKey: 'shelfLifeMonths', cell: (c) => <span className="num">{c.getValue() as number} mo</span> },
    { header: '', id: 'f', enableSorting: false, cell: ({ row: { original: r } }) => <Link href={`/formulas?product=${r.id}`} className="text-xs text-primary hover:underline" onClick={(e) => e.stopPropagation()}>Formulas</Link> },
  ];
  return (
    <>
      <PageHeader title="Formulas & BOM" description="Versioned master formulas with approval workflow. The approved version is the bill of materials used for every new batch." actions={can('formula:create') && <Button onClick={() => router.push('/formulas/new')}><Plus className="h-4 w-4" />New formula</Button>} />
      <Tabs defaultValue="formulas">
        <TabsList><TabsTrigger value="formulas">Formula versions</TabsTrigger><TabsTrigger value="products">Products</TabsTrigger></TabsList>
        <TabsContent value="formulas"><DataTable endpoint="/formulas" columns={cols} search="Search product…" onRowClick={(r) => router.push(`/formulas/${r.id}`)} filters={[{ key: 'status', label: 'Status', options: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'OBSOLETE'].map((v) => ({ value: v, label: humanize(v) })) }]} /></TabsContent>
        <TabsContent value="products"><DataTable endpoint="/products" columns={pcols} toolbar={can('production:create') && <Button size="sm" onClick={() => setProd(true)}><Plus className="h-3.5 w-3.5" />New product</Button>} /></TabsContent>
      </Tabs>
      <FormDialog title="New product" open={prod} onOpenChange={setProd} invalidate={['/products']} onSubmit={(v) => api('/products', { body: v })}
        fields={[{ name: 'code', label: 'Product code', required: true, half: true }, { name: 'name', label: 'Product name', required: true, half: true }, { name: 'dosageForm', label: 'Dosage form', half: true, placeholder: 'Tablet' }, { name: 'strength', label: 'Strength', half: true, placeholder: '500 mg' }, { name: 'uom', label: 'Unit', half: true, defaultValue: 'TAB' }, { name: 'packSize', label: 'Pack size', half: true }, { name: 'shelfLifeMonths', label: 'Shelf life (months)', type: 'number', half: true, defaultValue: 24 }, { name: 'sellingPrice', label: 'Selling price (₹ / unit)', type: 'number', half: true }]} />
    </>
  );
}
