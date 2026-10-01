'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { BarPair, CostYield, HBars } from '@/components/charts';
import { StatusBadge } from '@/components/status-badge';
import { Empty, PageHeader, Panel, Skeleton } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNum, humanize } from '@/lib/utils';

const STATE_COLOR: Record<string, string> = { OK: 'bg-success', REORDER: 'bg-warning', CRITICAL: 'bg-danger/80', OUT_OF_STOCK: 'bg-danger' };
const PIPE = ['DRAFT', 'APPROVED', 'IN_PRODUCTION', 'QC_REVIEW', 'RELEASED'];

export default function Dashboard() {
  const { data: d, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<any>('/dashboard'), refetchInterval: 60_000 });
  if (isLoading || !d) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-24" /><div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div></div>;
  const k = d.kpis;
  const stats: [string, string, string, string?][] = [
    ['Inventory value', fmtMoney(k.inventoryValue), '/inventory'],
    ['Finished goods', `${fmtNum(k.finishedGoodsUnits, 0)} units`, '/finished-goods'],
    ['Low-stock materials', String(k.lowStockCount), '/raw-materials', k.lowStockCount ? 'text-danger' : ''],
    ['Lots expiring ≤90 d', String(k.nearExpiryLots), '/expiry', k.nearExpiryLots ? 'text-warning' : ''],
    ['Expired lots on hand', String(k.expiredLots), '/expiry', k.expiredLots ? 'text-danger' : ''],
    ['QC samples pending', String(k.pendingQcSamples), '/qc'],
    ['Avg yield (6 mo)', k.avgYieldPct ? `${k.avgYieldPct.toFixed(1)}%` : '—', '/batches'],
  ];
  const total = d.rawMaterialStatus.reduce((a: number, s: any) => a + s.count, 0) || 1;
  const batchMap = Object.fromEntries(d.batchStatus.map((b: any) => [b.status, b.count]));

  return (
    <>
      <PageHeader title="Dashboard" description="Live position across stores, production and quality." />
      <div className="mb-5 grid grid-cols-2 divide-x divide-y rounded-lg border bg-card sm:grid-cols-4 lg:grid-cols-7 lg:divide-y-0">
        {stats.map(([label, value, href, tone]) => (
          <Link key={label} href={href} className="group px-4 py-3 hover:bg-tint/50">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={`num mt-0.5 text-xl font-semibold ${tone ?? ''}`}>{value}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Purchases vs consumption (₹, last 6 months)"><BarPair data={d.purchaseVsConsumption} a="purchase" b="consumption" aLabel="Purchased" bLabel="Consumed" money /></Panel>
        <Panel title="Manufacturing cost and yield"><CostYield data={d.manufacturingCost} /></Panel>

        <Panel title="Raw material stock status" action={<Link href="/raw-materials" className="text-xs text-primary hover:underline">All materials</Link>}>
          <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label="Stock status distribution">
            {d.rawMaterialStatus.map((s: any) => s.count > 0 && <div key={s.state} className={STATE_COLOR[s.state]} style={{ width: `${(s.count / total) * 100}%` }} title={`${humanize(s.state)}: ${s.count}`} />)}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
            {d.rawMaterialStatus.map((s: any) => <span key={s.state} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${STATE_COLOR[s.state]}`} />{humanize(s.state)} <b className="num">{s.count}</b></span>)}
          </div>
          {d.lowStock.length ? (
            <table className="mt-4 w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="pb-1 font-medium">Material</th><th className="pb-1 text-right font-medium">Usable</th><th className="pb-1 text-right font-medium">Min</th><th className="pb-1 pl-3 font-medium">State</th></tr></thead>
              <tbody>{d.lowStock.slice(0, 6).map((m: any) => <tr key={m.id} className="border-t"><td className="py-1.5"><span className="id-text mr-2 text-muted-foreground">{m.code}</span>{m.name}</td><td className="num text-right">{fmtNum(m.usable, 1)} {m.uom}</td><td className="num text-right text-muted-foreground">{fmtNum(m.min, 0)}</td><td className="pl-3"><StatusBadge status={m.state} /></td></tr>)}</tbody>
            </table>
          ) : <p className="mt-4 text-sm text-muted-foreground">All materials are above their reorder levels.</p>}
        </Panel>

        <Panel title="Batch pipeline" action={<Link href="/batches" className="text-xs text-primary hover:underline">All batches</Link>}>
          <ol className="grid grid-cols-5 gap-1">
            {PIPE.map((s, i) => (
              <li key={s} className="relative rounded border bg-muted/40 px-2 py-2 text-center">
                <div className="num text-xl font-semibold">{batchMap[s] ?? 0}</div>
                <div className="text-[0.6875rem] leading-tight text-muted-foreground">{humanize(s)}</div>
                {i < PIPE.length - 1 && <span aria-hidden className="absolute -right-1.5 top-1/2 z-10 h-2 w-2 -translate-y-1/2 rotate-45 border-r border-t bg-card" />}
              </li>
            ))}
          </ol>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th className="pb-1 font-medium">Batch</th><th className="pb-1 font-medium">Product</th><th className="pb-1 font-medium">Status</th><th className="pb-1 text-right font-medium">Yield</th></tr></thead>
              <tbody>{d.recentBatches.slice(0, 6).map((b: any) => <tr key={b.id} className="border-t"><td className="py-1.5"><Link href={`/batches/${b.id}`} className="id-text text-primary hover:underline">{b.batchNumber}</Link></td><td className="max-w-[10rem] truncate">{b.product}</td><td><StatusBadge status={b.status} /></td><td className="num text-right">{b.yieldPct ? `${b.yieldPct.toFixed(1)}%` : '—'}</td></tr>)}</tbody></table>
          </div>
        </Panel>

        <Panel title="Finished goods available (released)">{d.finishedGoods.length ? <HBars data={d.finishedGoods} x="quantity" y="product" /> : <Empty title="No released stock" hint="Finished goods appear here once QC releases a batch." />}</Panel>
        <Panel title="Top consumed materials (₹, 6 months)">{d.topConsumedMaterials.length ? <HBars data={d.topConsumedMaterials} x="value" y="name" color="hsl(217 45% 30%)" /> : <Empty title="No consumption yet" />}</Panel>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Batches this month: <b className="num">{k.batchesThisMonth}</b> · Open purchase orders: <b className="num">{k.openPurchaseOrders}</b> · Last refreshed {fmtDate(new Date())}</p>
    </>
  );
}
