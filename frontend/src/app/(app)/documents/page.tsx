'use client';
import { useQueryClient } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { Download, Link2, Upload } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/misc';
import { api, openFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, humanize } from '@/lib/utils';

const TYPES = ['BMR', 'BPR', 'QC_REPORT', 'COA', 'SUPPLIER_INVOICE', 'GST_BILL', 'PRODUCTION_REPORT', 'PURCHASE_ORDER', 'GRN', 'SUPPLIER_DOCUMENT', 'OTHER'];
const ROLES = ['PRODUCTION_MANAGER', 'WAREHOUSE_MANAGER', 'QC_MANAGER', 'PURCHASE_MANAGER', 'STORE_OPERATOR'];
const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export default function Documents() {
  const { can } = useAuth(); const qc = useQueryClient();
  const [up, setUp] = React.useState(false); const [ver, setVer] = React.useState<any>(null);
  const [type, setType] = React.useState('OTHER'); const [roles, setRoles] = React.useState<string[]>([]); const [files, setFiles] = React.useState<File[]>([]); const [busy, setBusy] = React.useState(false);

  const upload = async () => {
    setBusy(true);
    try {
      const fd = new FormData(); files.forEach((f) => fd.append(ver ? 'file' : 'files', f)); if (!ver) { fd.append('type', type); if (roles.length) fd.append('allowedRoles', roles.join(',')); }
      await api(ver ? `/documents/${ver.id}/versions` : '/documents', { form: fd }); toast.success(ver ? `Version ${ver.version + 1} uploaded` : 'Uploaded');
      qc.invalidateQueries({ queryKey: ['/documents'] }); setUp(false); setVer(null); setFiles([]);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const share = async (d: any) => { try { const r = await api<any>(`/documents/${d.id}/share`, { body: { hours: 72 } }); await navigator.clipboard?.writeText(r.url); toast.success('Expiring link (72 h) copied to clipboard'); } catch (e) { toast.error((e as Error).message); } };
  const cols: ColumnDef<any>[] = [
    { header: 'Title', accessorKey: 'title', cell: (c) => <span className="font-medium">{c.getValue() as string}</span> }, { header: 'Type', accessorKey: 'type', cell: (c) => <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{humanize(c.getValue() as string)}</span> },
    { header: 'Version', accessorKey: 'version', cell: (c) => <span className="num">v{c.getValue() as number}</span> }, { header: 'Size', accessorKey: 'size', cell: (c) => <span className="num text-muted-foreground">{size(c.getValue() as number)}</span> },
    { header: 'Access', accessorKey: 'allowedRoles', cell: (c) => <span className="text-xs text-muted-foreground">{(c.getValue() as string[]).length ? (c.getValue() as string[]).map(humanize).join(', ') : 'All staff'}</span> }, { header: 'Added', accessorKey: 'createdAt', cell: (c) => <span className="num text-muted-foreground">{fmtDateTime(c.getValue() as string)}</span> },
    { header: '', id: 'a', enableSorting: false, cell: ({ row: { original: r } }) => <div className="flex justify-end gap-0.5"><Button variant="ghost" size="icon" title="Download" onClick={() => openFile(`/documents/${r.id}/download`, { download: r.title }).catch((e) => toast.error(e.message))}><Download className="h-4 w-4" /></Button>{can('document:create') && <><Button variant="ghost" size="icon" title="Copy expiring share link" onClick={() => share(r)}><Link2 className="h-4 w-4" /></Button><Button variant="ghost" size="sm" onClick={() => { setVer(r); setUp(true); }}>New version</Button></>}</div> },
  ];
  return (
    <>
      <PageHeader title="Documents" description="Batch records, QC reports, COAs, invoices and production reports with version history, search and role-based access." actions={can('document:create') && <Button onClick={() => { setVer(null); setUp(true); }}><Upload className="h-4 w-4" />Upload</Button>} />
      <DataTable endpoint="/documents" columns={cols} search="Search title or file name…" filters={[{ key: 'type', label: 'Type', options: TYPES.map((v) => ({ value: v, label: humanize(v) })) }]} />
      <Dialog open={up} onOpenChange={(o) => { setUp(o); if (!o) setVer(null); }}><DialogContent title={ver ? `New version of "${ver.title}"` : 'Upload documents'} description={ver ? 'The previous version stays available in history.' : undefined}>
        <div className="space-y-3"><div><Label htmlFor="f">{ver ? 'File' : 'Files'}</Label><Input id="f" type="file" multiple={!ver} onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="h-auto py-1.5" /></div>
          {!ver && <><div><Label htmlFor="t">Document type</Label><Select id="t" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select></div>
            <fieldset><legend className="field-label">Restrict to roles <span className="font-normal text-muted-foreground">(none = all staff)</span></legend><div className="flex flex-wrap gap-x-4 gap-y-1">{ROLES.map((r) => <label key={r} className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="accent-[hsl(var(--primary))]" checked={roles.includes(r)} onChange={(e) => setRoles((x) => e.target.checked ? [...x, r] : x.filter((y) => y !== r))} />{humanize(r)}</label>)}</div></fieldset></>}
          <div className="flex justify-end gap-2 pt-1"><Button variant="outline" onClick={() => setUp(false)}>Cancel</Button><Button loading={busy} disabled={!files.length} onClick={upload}>Upload</Button></div></div>
      </DialogContent></Dialog>
    </>
  );
}
