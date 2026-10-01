'use client';
import { useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import * as React from 'react';
import { DataTable } from '@/components/data-table';
import { FormDialog, Field } from '@/components/form-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { PageHeader } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtMoney2 } from '@/lib/utils';

const FIELDS: Field[] = [
  { name: 'code', label: 'Supplier code', required: true, half: true }, { name: 'name', label: 'Name', required: true, half: true }, { name: 'gstin', label: 'GSTIN', half: true, placeholder: '27AABCU9603R1ZM' }, { name: 'contactName', label: 'Contact person', half: true },
  { name: 'email', label: 'Email', type: 'email', half: true }, { name: 'phone', label: 'Phone', half: true }, { name: 'paymentTerms', label: 'Payment terms', half: true, placeholder: 'Net 30' }, { name: 'address', label: 'Address' },
  { name: 'isApproved', label: 'On approved vendor list', type: 'checkbox' },
];

export default function Suppliers() {
  const { can } = useAuth();
  const [open, setOpen] = React.useState(false); const [edit, setEdit] = React.useState<any>(null); const [detail, setDetail] = React.useState<any>(null);
  const cols: ColumnDef<any>[] = [
    { header: 'Code', accessorKey: 'code', cell: (c) => <span className="id-text">{c.getValue() as string}</span> }, { header: 'Supplier', accessorKey: 'name', cell: (c) => <span className="font-medium">{c.getValue() as string}</span> },
    { header: 'GSTIN', accessorKey: 'gstin', cell: (c) => <span className="id-text text-muted-foreground">{(c.getValue() as string) ?? '—'}</span> }, { header: 'Terms', accessorKey: 'paymentTerms' },
    { header: 'Vendor status', accessorKey: 'isApproved', cell: (c) => <StatusBadge status={c.getValue() ? 'APPROVED' : 'PENDING'} /> },
    { header: '', id: 'a', enableSorting: false, cell: ({ row: { original: r } }) => can('supplier:update') ? <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEdit(r); }}>Edit</Button> : null },
  ];
  return (
    <>
      <PageHeader title="Suppliers" description="Approved vendor list, price history, performance and documents." />
      <DataTable endpoint="/suppliers" columns={cols} search="Search name, code or GSTIN…" onRowClick={setDetail} toolbar={can('supplier:create') && <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" />New supplier</Button>} />
      <FormDialog title="New supplier" fields={FIELDS} open={open} onOpenChange={setOpen} wide invalidate={['/suppliers']} onSubmit={(v) => api('/suppliers', { body: v })} />
      <FormDialog title="Edit supplier" fields={FIELDS.filter((f) => f.name !== 'code')} open={!!edit} onOpenChange={(o) => !o && setEdit(null)} wide initial={edit ?? undefined} invalidate={['/suppliers']} onSubmit={(v) => api(`/suppliers/${edit.id}`, { method: 'PATCH', body: v })} />
      <Detail s={detail} onClose={() => setDetail(null)} />
    </>
  );
}

function Detail({ s, onClose }: { s: any; onClose: () => void }) {
  const { data: p } = useQuery({ queryKey: ['sup-perf', s?.id], enabled: !!s, queryFn: () => api<any>(`/suppliers/${s.id}/performance`) });
  const { data: scores } = useQuery({ queryKey: ['/analytics/suppliers'], enabled: !!s, queryFn: () => api<any[]>('/analytics/suppliers').catch(() => []) });
  const sc = scores?.find((x) => x.supplierId === s?.id);
  return (
    <Dialog open={!!s} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={s?.name ?? ''} description={s ? `${s.code} · ${s.gstin ?? 'no GSTIN'}` : undefined} wide>
        {sc && <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded border bg-border sm:grid-cols-5">{([['Score', sc.score ?? '—'], ['On-time', sc.onTimePct != null ? `${sc.onTimePct}%` : '—'], ['Fill rate', sc.fillRatePct != null ? `${sc.fillRatePct}%` : '—'], ['Quality', sc.qualityPct != null ? `${sc.qualityPct}%` : '—'], ['Price stability', sc.priceStabilityPct != null ? `${sc.priceStabilityPct}%` : '—']] as const).map(([k, v]) => <div key={k} className="bg-card px-3 py-2"><div className="text-xs text-muted-foreground">{k}</div><div className="num text-base font-semibold">{v}</div></div>)}</div>}
        <h3 className="mb-1 text-sm font-semibold">Recent price history</h3>
        <table className="mb-4 w-full text-sm"><tbody>{p?.priceHistory.slice(0, 8).map((x: any) => <tr key={x.id} className="border-t"><td className="py-1.5">{x.rawMaterial.name}</td><td className="num text-right">{fmtMoney2(x.price)}</td><td className="pl-3 text-right text-muted-foreground">{fmtDate(x.effectiveDate)}</td></tr>)}{!p?.priceHistory.length && <tr><td className="py-2 text-muted-foreground">No purchases yet.</td></tr>}</tbody></table>
        <h3 className="mb-1 text-sm font-semibold">Purchase orders</h3>
        <table className="w-full text-sm"><tbody>{p?.purchaseOrders.map((x: any) => <tr key={x.id} className="border-t"><td className="py-1.5 id-text">{x.poNumber}</td><td><StatusBadge status={x.status} /></td><td className="num text-right">{fmtMoney2(x.total)}</td><td className="pl-3 text-right text-muted-foreground">{fmtDate(x.orderDate)}</td></tr>)}{!p?.purchaseOrders.length && <tr><td className="py-2 text-muted-foreground">None.</td></tr>}</tbody></table>
      </DialogContent>
    </Dialog>
  );
}
