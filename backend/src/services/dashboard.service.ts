import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { D, prisma } from '../lib/prisma';
import { stockByMaterial, stockState } from './inventory.service';

const day = 86_400_000;

export async function dashboard() {
  const now = new Date();
  const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const horizon = new Date(now.getTime() + env.EXPIRY_WARNING_DAYS * day);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [stock, materials, lotValue, fgAgg, fgByProduct, batchStatus, woStatus, nearExp, expired, pendingQc, pendingPo, flows, costs, topConsumed, recentBatches, yieldAgg, monthBatches] = await Promise.all([
    stockByMaterial(),
    prisma.rawMaterial.findMany({ where: { status: 'ACTIVE' }, select: { id: true, code: true, name: true, uom: true, minStock: true, reorderLevel: true, category: true } }),
    prisma.$queryRaw<{ value: Prisma.Decimal | null }[]>`SELECT COALESCE(SUM("availableQty" * "unitCost"),0) AS value FROM "MaterialLot" WHERE status IN ('APPROVED','QUARANTINE')`,
    prisma.finishedGoodLot.aggregate({ where: { status: 'RELEASED' }, _sum: { availableQty: true, reservedQty: true } }),
    prisma.finishedGoodLot.groupBy({ by: ['productId'], where: { status: 'RELEASED', availableQty: { gt: 0 } }, _sum: { availableQty: true } }),
    prisma.batch.groupBy({ by: ['status'], _count: true }),
    prisma.workOrder.groupBy({ by: ['status'], _count: true }),
    prisma.materialLot.count({ where: { availableQty: { gt: 0 }, status: { in: ['APPROVED', 'QUARANTINE'] }, expiryDate: { gt: now, lte: horizon } } }),
    prisma.materialLot.count({ where: { availableQty: { gt: 0 }, OR: [{ status: 'EXPIRED' }, { expiryDate: { lte: now } }] } }),
    prisma.qcSample.count({ where: { status: { in: ['PENDING', 'IN_TESTING'] } } }),
    prisma.purchaseOrder.count({ where: { status: { in: ['PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED'] } } }),
    prisma.$queryRaw<{ month: string; type: string; value: Prisma.Decimal }[]>`
      SELECT to_char(date_trunc('month', "createdAt"),'YYYY-MM') AS month, type::text AS type, SUM(ABS(quantity) * COALESCE("unitCost",0)) AS value
      FROM "StockMovement" WHERE type IN ('RECEIPT','CONSUMPTION') AND "createdAt" >= ${sixMonthsAgo} GROUP BY 1,2 ORDER BY 1`,
    prisma.$queryRaw<{ month: string; cost: Prisma.Decimal; batches: bigint; avg_yield: Prisma.Decimal | null }[]>`
      SELECT to_char(date_trunc('month', "mfgDate"),'YYYY-MM') AS month, COALESCE(SUM("materialCost"),0) AS cost, COUNT(*) AS batches, AVG("yieldPct") AS avg_yield
      FROM "Batch" WHERE "mfgDate" >= ${sixMonthsAgo} AND status NOT IN ('DRAFT','CANCELLED') GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ name: string; code: string; value: Prisma.Decimal }[]>`
      SELECT rm.name, rm.code, SUM(ABS(m.quantity) * COALESCE(m."unitCost",0)) AS value
      FROM "StockMovement" m JOIN "MaterialLot" l ON l.id = m."materialLotId" JOIN "RawMaterial" rm ON rm.id = l."rawMaterialId"
      WHERE m.type = 'CONSUMPTION' AND m."createdAt" >= ${sixMonthsAgo} GROUP BY rm.name, rm.code ORDER BY value DESC LIMIT 6`,
    prisma.batch.findMany({ orderBy: { createdAt: 'desc' }, take: 8, include: { product: { select: { name: true } } } }),
    prisma.batch.aggregate({ where: { yieldPct: { not: null }, mfgDate: { gte: sixMonthsAgo } }, _avg: { yieldPct: true } }),
    prisma.batch.count({ where: { mfgDate: { gte: monthStart }, status: { notIn: ['DRAFT', 'CANCELLED'] } } }),
  ]);

  const rmStatus = { OK: 0, REORDER: 0, CRITICAL: 0, OUT_OF_STOCK: 0 } as Record<string, number>;
  const lowStock: any[] = [];
  for (const m of materials) {
    const usable = stock.get(m.id)?.usable ?? D(0);
    const st = stockState(usable, m.minStock, m.reorderLevel);
    rmStatus[st]++;
    if (st !== 'OK') lowStock.push({ id: m.id, code: m.code, name: m.name, uom: m.uom, usable: usable.toString(), min: m.minStock.toString(), reorder: m.reorderLevel.toString(), state: st });
  }
  lowStock.sort((a, b) => (a.state === 'OUT_OF_STOCK' ? -1 : 0) - (b.state === 'OUT_OF_STOCK' ? -1 : 0));

  const prods = await prisma.product.findMany({ where: { id: { in: fgByProduct.map((p) => p.productId) } }, select: { id: true, name: true } });
  const pname = new Map(prods.map((p) => [p.id, p.name]));
  const months = [...new Set([...flows.map((f) => f.month), ...costs.map((c) => c.month)])].sort();

  return {
    kpis: {
      rawMaterialSkus: materials.length,
      inventoryValue: Number(lotValue[0]?.value ?? 0),
      finishedGoodsUnits: Number(fgAgg._sum.availableQty ?? 0),
      finishedGoodsReserved: Number(fgAgg._sum.reservedQty ?? 0),
      lowStockCount: lowStock.length,
      nearExpiryLots: nearExp,
      expiredLots: expired,
      pendingQcSamples: pendingQc,
      openPurchaseOrders: pendingPo,
      batchesThisMonth: monthBatches,
      avgYieldPct: yieldAgg._avg.yieldPct ? Number(yieldAgg._avg.yieldPct) : null,
    },
    rawMaterialStatus: Object.entries(rmStatus).map(([state, count]) => ({ state, count })),
    lowStock: lowStock.slice(0, 10),
    finishedGoods: fgByProduct.map((p) => ({ product: pname.get(p.productId) ?? p.productId, quantity: Number(p._sum.availableQty ?? 0) })).sort((a, b) => b.quantity - a.quantity).slice(0, 8),
    batchStatus: batchStatus.map((b) => ({ status: b.status, count: b._count })),
    workOrderStatus: woStatus.map((w) => ({ status: w.status, count: w._count })),
    purchaseVsConsumption: months.map((m) => ({
      month: m,
      purchase: Number(flows.find((f) => f.month === m && f.type === 'RECEIPT')?.value ?? 0),
      consumption: Number(flows.find((f) => f.month === m && f.type === 'CONSUMPTION')?.value ?? 0),
    })),
    manufacturingCost: costs.map((c) => ({ month: c.month, cost: Number(c.cost), batches: Number(c.batches), avgYield: c.avg_yield ? Number(c.avg_yield) : null })),
    topConsumedMaterials: topConsumed.map((t) => ({ name: t.name, code: t.code, value: Number(t.value) })),
    recentBatches: recentBatches.map((b) => ({ id: b.id, batchNumber: b.batchNumber, product: b.product.name, status: b.status, qcStatus: b.qcStatus, batchSize: Number(b.batchSize), yieldPct: b.yieldPct ? Number(b.yieldPct) : null, mfgDate: b.mfgDate })),
  };
}
