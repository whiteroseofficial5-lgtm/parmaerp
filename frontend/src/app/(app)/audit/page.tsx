'use client';
import { useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import * as React from 'react';
import { DataTable } from '@/components/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { PageHeader } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { fmtDateTime, humanize } from '@/lib/utils';

const skip = new Set(['updatedAt', 'createdAt']);
function Diff({ before, after }: { before: any; after: any }) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter((k) => !skip.has(k));
  const rows = keys.filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]));
  const show = (v: any) => (v === undefined ? '—' : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));
  return (
    <table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th className="pb-1">Field</th><th className="pb-1">Before</th><th className="pb-1">After</th></tr></thead>
      <tbody>{(before && after ? rows : keys).map((k) => <tr key={k} className="border-t align-top"><td className="py-1.5 pr-3 font-medium">{k}</td><td className="max-w-[16rem] break-words py-1.5 pr-3 font-mono text-xs text-danger/90">{show(before?.[k])}</td><td className="max-w-[16rem] break-words py-1.5 font-mono text-xs text-success">{show(after?.[k])}</td></tr>)}{!keys.length && <tr><td colSpan={3} className="py-3 text-muted-foreground">No field-level data.</td></tr>}</tbody></table>
  );
}

export default function Audit() {
  const [sel, setSel] = React.useState<any>(null);
  const { data: entities } = useQuery({ queryKey: ['/audit/entities'], queryFn: () => api<string[]>('/audit/entities') });
  const cols: ColumnDef<any>[] = [
    { header: 'When', accessorKey: 'createdAt', cell: (c) => <span className="num text-muted-foreground">{fmtDateTime(c.getValue() as string)}</span> },
    { header: 'User', accessorKey: 'userEmail', cell: ({ row: { original: r } }) => <span>{r.userEmail ?? 'system'}<div className="text-xs text-muted-foreground">{humanize(r.userRole)}</div></span> },
    { header: 'Action', accessorKey: 'action', cell: (c) => <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{c.getValue() as string}</span> },
    { header: 'Entity', accessorKey: 'entity' }, { header: 'Record', accessorKey: 'entityId', cell: (c) => <span className="id-text text-muted-foreground">{((c.getValue() as string) ?? '').slice(-10)}</span> },
    { header: 'IP', accessorKey: 'ip', cell: (c) => <span className="id-text text-muted-foreground">{c.getValue() as string}</span> },
  ];
  return (
    <>
      <PageHeader title="Audit trail" description="Append-only record of every create, update, delete, approval and sign-in — with before and after values. Open a row to see what changed." />
      <DataTable endpoint="/audit" columns={cols} pageSize={50} search="Search user, entity or record id…" onRowClick={setSel} filters={[{ key: 'entity', label: 'Entity', options: (entities ?? []).map((e) => ({ value: e, label: e })) }, { key: 'action', label: 'Action', options: ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGIN_FAILED', 'DOWNLOAD', 'AI_SEARCH'].map((v) => ({ value: v, label: v })) }]} />
      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}><DialogContent title={sel ? `${sel.action} · ${sel.entity}` : ''} description={sel ? `${sel.userEmail ?? 'system'} · ${fmtDateTime(sel.createdAt)}` : undefined} wide>{sel && <Diff before={sel.before} after={sel.after} />}</DialogContent></Dialog>
    </>
  );
}
