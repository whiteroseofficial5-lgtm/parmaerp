'use client';
import { ColumnDef } from '@tanstack/react-table';
import { FileText } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, openFile } from '@/lib/api';
import { fmtDateTime, humanize } from '@/lib/utils';

export default function QC() {
  const router = useRouter();
  const cols: ColumnDef<any>[] = [
    { header: 'Sample', accessorKey: 'sampleNumber', cell: (c) => <span className="id-text font-medium">{c.getValue() as string}</span> },
    { header: 'Type', accessorKey: 'type', cell: (c) => <span className="text-muted-foreground">{humanize(c.getValue() as string)}</span> },
    { header: 'Subject', id: 's', accessorFn: (r) => r.materialLot ? `${r.materialLot.rawMaterial.name} · ${r.materialLot.lotNumber}` : `${r.batch?.product.name} · ${r.batch?.batchNumber}` },
    { header: 'Tests', id: 't', accessorFn: (r) => r._count.results, cell: (c) => <span className="num">{c.getValue() as number}</span> },
    { header: 'Status', accessorKey: 'status', cell: (c) => <StatusBadge status={c.getValue() as string} /> },
    { header: 'Collected', accessorKey: 'collectedAt', cell: (c) => <span className="num text-muted-foreground">{fmtDateTime(c.getValue() as string)}</span> },
    { header: 'COA', id: 'coa', enableSorting: false, cell: ({ row: { original: r } }) => r.coa?.documentId ? <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openFile(`/documents/${r.coa.documentId}/download`, { query: { inline: true } }).catch((x) => toast.error(x.message)); }}><FileText className="h-3.5 w-3.5" />{r.coa.coaNumber}</Button> : <span className="text-muted-foreground">—</span> },
  ];
  const tbl = (extra?: Record<string, string>) => <DataTable endpoint="/qc/samples" columns={cols} extraQuery={extra} search="Search sample no…" onRowClick={(r) => router.push(`/qc/${r.id}`)} />;
  return (
    <>
      <PageHeader title="Quality control" description="Sample tracking, testing, pass/fail review and certificate of analysis. Passing a raw-material sample releases the lot from quarantine." />
      <Tabs defaultValue="pending">
        <TabsList><TabsTrigger value="pending">Awaiting testing</TabsTrigger><TabsTrigger value="testing">In testing</TabsTrigger><TabsTrigger value="done">Completed</TabsTrigger><TabsTrigger value="all">All</TabsTrigger></TabsList>
        <TabsContent value="pending">{tbl({ status: 'PENDING' })}</TabsContent><TabsContent value="testing">{tbl({ status: 'IN_TESTING' })}</TabsContent>
        <TabsContent value="done">{tbl({ status: 'PASSED' })}<div className="mt-4">{tbl({ status: 'FAILED' })}</div></TabsContent><TabsContent value="all">{tbl()}</TabsContent>
      </Tabs>
    </>
  );
}
