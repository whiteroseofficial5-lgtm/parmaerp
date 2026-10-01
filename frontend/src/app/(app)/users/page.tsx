'use client';
import { useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import * as React from 'react';
import { DataTable } from '@/components/data-table';
import { FormDialog } from '@/components/form-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { PageHeader, Panel } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, humanize } from '@/lib/utils';

const ROLES = ['SUPER_ADMIN', 'PRODUCTION_MANAGER', 'WAREHOUSE_MANAGER', 'QC_MANAGER', 'PURCHASE_MANAGER', 'STORE_OPERATOR', 'AUDITOR'].map((v) => ({ value: v, label: humanize(v) }));

export default function Users() {
  const { can, user } = useAuth();
  const [open, setOpen] = React.useState(false); const [edit, setEdit] = React.useState<any>(null);
  const { data: matrix } = useQuery({ queryKey: ['matrix'], queryFn: () => api<Record<string, string[]>>('/users/roles/matrix') });
  const cols: ColumnDef<any>[] = [
    { header: 'Name', accessorKey: 'name', cell: (c) => <span className="font-medium">{c.getValue() as string}</span> }, { header: 'Email', accessorKey: 'email' }, { header: 'Role', accessorKey: 'role', cell: (c) => humanize(c.getValue() as string) },
    { header: 'Status', accessorKey: 'isActive', cell: (c) => <StatusBadge status={c.getValue() ? 'ACTIVE' : 'INACTIVE'} /> }, { header: 'Last sign-in', accessorKey: 'lastLoginAt', cell: (c) => <span className="num text-muted-foreground">{fmtDateTime(c.getValue() as string)}</span> },
    { header: '', id: 'a', enableSorting: false, cell: ({ row: { original: r } }) => can('user:update') && r.id !== user?.id ? <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Edit</Button> : null },
  ];
  const groups = matrix ? [...new Set(Object.values(matrix).flat().filter((p) => p !== '*').map((p) => p.split(':')[0]))].sort() : [];
  return (
    <>
      <PageHeader title="Users & roles" description="Role-based access control. Segregation of duties is enforced in the API: authors cannot approve their own formulas, batches, POs or QC results." />
      <Tabs defaultValue="users"><TabsList><TabsTrigger value="users">Users</TabsTrigger><TabsTrigger value="matrix">Permission matrix</TabsTrigger></TabsList>
        <TabsContent value="users"><DataTable endpoint="/users" columns={cols} search="Search name or email…" toolbar={can('user:create') && <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" />New user</Button>} /></TabsContent>
        <TabsContent value="matrix"><Panel flush><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Resource</th>{Object.keys(matrix ?? {}).map((r) => <th key={r} className="px-3 py-2 font-semibold">{humanize(r)}</th>)}</tr></thead>
          <tbody>{groups.map((g) => <tr key={g} className="border-t"><td className="px-3 py-1.5 font-medium">{g}</td>{Object.entries(matrix ?? {}).map(([r, perms]) => { const p = perms.includes('*') ? ['all'] : perms.filter((x) => x.startsWith(g + ':')).map((x) => x.split(':')[1]); return <td key={r} className="px-3 py-1.5 text-xs text-muted-foreground">{p.join(', ') || <span className="opacity-40">—</span>}</td>; })}</tr>)}</tbody></table></div></Panel></TabsContent></Tabs>
      <FormDialog title="New user" open={open} onOpenChange={setOpen} invalidate={['/users']} fields={[{ name: 'name', label: 'Full name', required: true, half: true }, { name: 'email', label: 'Email', type: 'email', required: true, half: true }, { name: 'role', label: 'Role', type: 'select', required: true, options: ROLES, half: true }, { name: 'employeeCode', label: 'Employee code', half: true }, { name: 'password', label: 'Temporary password', type: 'password', required: true, hint: 'At least 10 characters' }]} onSubmit={(v) => api('/users', { body: v })} />
      <FormDialog title={`Edit ${edit?.name ?? ''}`} open={!!edit} onOpenChange={(o) => !o && setEdit(null)} initial={edit ?? undefined} invalidate={['/users']} fields={[{ name: 'name', label: 'Full name', half: true }, { name: 'role', label: 'Role', type: 'select', options: ROLES, half: true }, { name: 'isActive', label: 'Account active', type: 'checkbox' }, { name: 'password', label: 'Reset password', type: 'password', hint: 'Leave blank to keep current' }]} onSubmit={(v) => api(`/users/${edit.id}`, { method: 'PATCH', body: v })} />
    </>
  );
}
