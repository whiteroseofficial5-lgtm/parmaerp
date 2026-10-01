'use client';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ColumnDef, flexRender, getCoreRowModel, getSortedRowModel, SortingState, useReactTable } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import * as React from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Input, Select } from './ui/input';
import { Empty, Skeleton } from './ui/misc';

export interface FilterDef { key: string; label: string; options: { value: string; label: string }[] }
interface Props<T> {
  endpoint: string;
  columns: ColumnDef<T, any>[];
  queryKey?: unknown[];
  filters?: FilterDef[];
  toolbar?: React.ReactNode;
  pageSize?: number;
  search?: string | false;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyHint?: string;
  extraQuery?: Record<string, unknown>;
  rowClassName?: (row: T) => string | undefined;
}

export function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = React.useState(v);
  React.useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

/** Server-paginated, searchable, filterable, sortable table with CSV export of the visible page. */
export function DataTable<T>({ endpoint, columns, queryKey, filters, toolbar, pageSize = 25, search = 'Search…', onRowClick, emptyTitle = 'Nothing here yet', emptyHint, extraQuery, rowClassName }: Props<T>) {
  const [page, setPage] = React.useState(1);
  const [q, setQ] = React.useState('');
  const [fv, setFv] = React.useState<Record<string, string>>({});
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const dq = useDebounced(q);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: [endpoint, ...(queryKey ?? []), page, pageSize, dq, fv, extraQuery],
    queryFn: () => api<{ data: T[]; meta: { total: number; pages: number } }>(endpoint, { query: { page, pageSize, q: dq, ...fv, ...extraQuery } }),
    placeholderData: keepPreviousData,
  });
  React.useEffect(() => setPage(1), [dq, fv]);

  const table = useReactTable({ data: data?.data ?? [], columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() });

  const exportCsv = () => {
    const heads = table.getVisibleLeafColumns().filter((c) => typeof c.columnDef.header === 'string');
    const lines = [heads.map((h) => JSON.stringify(h.columnDef.header)).join(','), ...table.getRowModel().rows.map((r) => heads.map((h) => JSON.stringify(String(r.getValue(h.id) ?? ''))).join(','))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv' }));
    a.download = `${endpoint.replace(/\W+/g, '-').replace(/^-|-$/g, '')}.csv`;
    a.click();
  };

  const meta = data?.meta;
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        {search !== false && (
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={search} className="pl-8" aria-label="Search" />
          </div>
        )}
        {filters?.map((f) => (
          <Select key={f.key} value={fv[f.key] ?? ''} onChange={(e) => setFv((s) => ({ ...s, [f.key]: e.target.value }))} className="w-auto min-w-[9rem]" aria-label={f.label}>
            <option value="">{f.label}: all</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {toolbar}
          <Button variant="outline" size="sm" onClick={exportCsv} title="Export this page as CSV"><Download className="h-3.5 w-3.5" />CSV</Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className={cn('whitespace-nowrap px-3 py-2 text-xs font-semibold text-muted-foreground', h.column.getCanSort() && 'cursor-pointer select-none')} onClick={h.column.getToggleSortingHandler()} aria-sort={h.column.getIsSorted() === 'asc' ? 'ascending' : h.column.getIsSorted() === 'desc' ? 'descending' : 'none'}>
                    <span className="inline-flex items-center gap-1">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getIsSorted() === 'asc' && <ArrowUp className="h-3 w-3" />}
                      {h.column.getIsSorted() === 'desc' && <ArrowDown className="h-3 w-3" />}
                    </span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className={cn(isFetching && !isLoading && 'opacity-60 transition-opacity')}>
            {isLoading && Array.from({ length: 6 }).map((_, i) => <tr key={i} className="border-t">{columns.map((_, j) => <td key={j} className="px-3 py-3"><Skeleton className="h-4 w-full" /></td>)}</tr>)}
            {table.getRowModel().rows.map((r) => (
              <tr key={r.id} onClick={() => onRowClick?.(r.original)} className={cn('border-t', onRowClick && 'cursor-pointer hover:bg-tint/50', rowClassName?.(r.original))}>
                {r.getVisibleCells().map((c) => <td key={c.id} className="px-3 py-2.5 align-middle">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && !table.getRowModel().rows.length && <Empty title={error ? 'Could not load data' : emptyTitle} hint={error ? (error as Error).message : emptyHint} />}
      </div>

      {meta && meta.total > 0 && (
        <div className="flex items-center justify-between gap-3 border-t px-3 py-2 text-[0.8125rem] text-muted-foreground">
          <span className="num">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, meta.total)} of {meta.total}</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
            <span className="num px-1">{page} / {meta.pages}</span>
            <Button variant="ghost" size="icon" disabled={page >= meta.pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
