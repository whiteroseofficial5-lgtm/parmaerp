'use client';
import { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import * as React from 'react';
import { DataTable } from '@/components/data-table';
import { FormDialog } from '@/components/form-dialog';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function Warehouses() {
  const { can } = useAuth();
  const [dlg, setDlg] = React.useState<'wh' | 'rack' | 'bin' | null>(null);
  const wcols: ColumnDef<any>[] = [{ header: 'Code', accessorKey: 'code', cell: (c) => <span className="id-text">{c.getValue() as string}</span> }, { header: 'Warehouse', accessorKey: 'name' }, { header: 'Type', accessorKey: 'type' }, { header: 'Racks', id: 'r', accessorFn: (r) => r._count.racks }, { header: 'Bins', id: 'b', accessorFn: (r) => r._count.bins }];
  const rcols: ColumnDef<any>[] = [{ header: 'Rack', accessorKey: 'code', cell: (c) => <span className="id-text">{c.getValue() as string}</span> }, { header: 'Description', accessorKey: 'description' }];
  const bcols: ColumnDef<any>[] = [{ header: 'Bin', accessorKey: 'code', cell: (c) => <span className="id-text">{c.getValue() as string}</span> }, { header: 'Rack', id: 'r', accessorFn: (r) => r.rack?.code ?? '—' }, { header: 'Barcode', accessorKey: 'barcode', cell: (c) => <span className="id-text text-muted-foreground">{(c.getValue() as string) ?? '—'}</span> }];
  const add = (k: 'wh' | 'rack' | 'bin') => can('warehouse:create') && <Button size="sm" onClick={() => setDlg(k)}><Plus className="h-3.5 w-3.5" />Add</Button>;
  const WH = { endpoint: '/warehouses', label: (r: any) => r.name };
  return (
    <>
      <PageHeader title="Warehouses" description="Multiple warehouses with racks and barcode-labelled bin locations." />
      <Tabs defaultValue="wh"><TabsList><TabsTrigger value="wh">Warehouses</TabsTrigger><TabsTrigger value="rack">Racks</TabsTrigger><TabsTrigger value="bin">Bins</TabsTrigger></TabsList>
        <TabsContent value="wh"><DataTable endpoint="/warehouses" columns={wcols} toolbar={add('wh')} /></TabsContent>
        <TabsContent value="rack"><DataTable endpoint="/racks" columns={rcols} toolbar={add('rack')} /></TabsContent>
        <TabsContent value="bin"><DataTable endpoint="/bins" columns={bcols} pageSize={50} toolbar={add('bin')} /></TabsContent></Tabs>
      <FormDialog title="New warehouse" open={dlg === 'wh'} onOpenChange={(o) => !o && setDlg(null)} invalidate={['/warehouses']} fields={[{ name: 'code', label: 'Code', required: true, half: true }, { name: 'name', label: 'Name', required: true, half: true }, { name: 'type', label: 'Type', type: 'select', half: true, defaultValue: 'GENERAL', options: ['GENERAL', 'RAW_MATERIAL', 'FINISHED_GOODS', 'QUARANTINE', 'COLD_STORAGE'].map((v) => ({ value: v, label: v.replace('_', ' ').toLowerCase() })) }, { name: 'address', label: 'Address' }]} onSubmit={(v) => api('/warehouses', { body: v })} />
      <FormDialog title="New rack" open={dlg === 'rack'} onOpenChange={(o) => !o && setDlg(null)} invalidate={['/racks']} fields={[{ name: 'warehouseId', label: 'Warehouse', type: 'select', required: true, optionsFrom: WH }, { name: 'code', label: 'Rack code', required: true }, { name: 'description', label: 'Description' }]} onSubmit={(v) => api('/racks', { body: v })} />
      <FormDialog title="New bin" open={dlg === 'bin'} onOpenChange={(o) => !o && setDlg(null)} invalidate={['/bins']} fields={[{ name: 'warehouseId', label: 'Warehouse', type: 'select', required: true, optionsFrom: WH }, { name: 'rackId', label: 'Rack', type: 'select', optionsFrom: { endpoint: '/racks', label: (r) => r.code } }, { name: 'code', label: 'Bin code', required: true, half: true }, { name: 'barcode', label: 'Barcode', half: true, placeholder: 'BIN|RM|R1-A' }]} onSubmit={(v) => api('/bins', { body: v })} />
    </>
  );
}
