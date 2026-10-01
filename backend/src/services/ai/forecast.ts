import { D, prisma } from '../../lib/prisma';
import { monthKey } from '../dates';
import { stockByMaterial } from '../inventory.service';

const day = 86_400_000;
import { holt, mean, std } from '../../lib/stats';
export { holt };

async function monthlyConsumption(months: number) {
  const since = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - months + 1, 1));
  const rows = await prisma.$queryRaw<{ rid: string; month: string; qty: any }[]>`
    SELECT l."rawMaterialId" AS rid, to_char(date_trunc('month', m."createdAt"),'YYYY-MM') AS month, SUM(ABS(m.quantity)) AS qty
    FROM "StockMovement" m JOIN "MaterialLot" l ON l.id = m."materialLotId"
    WHERE m.type = 'CONSUMPTION' AND m."createdAt" >= ${since} GROUP BY 1,2`;
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) keys.push(monthKey(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - i, 1))));
  const by = new Map<string, Map<string, number>>();
  rows.forEach((r) => { if (!by.has(r.rid)) by.set(r.rid, new Map()); by.get(r.rid)!.set(r.month, Number(r.qty)); });
  return { keys, by };
}

/** Average supplier lead time (PO date → first GRN) per material, default 14 days. */
async function leadTimes() {
  const rows = await prisma.$queryRaw<{ rid: string; days: any }[]>`
    SELECT gi."rawMaterialId" AS rid, AVG(EXTRACT(EPOCH FROM (g."receivedAt" - po."orderDate")) / 86400) AS days
    FROM "Grn" g JOIN "PurchaseOrder" po ON po.id = g."poId" JOIN "GrnItem" gi ON gi."grnId" = g.id GROUP BY 1`;
  return new Map(rows.map((r) => [r.rid, Math.max(1, Number(r.days))]));
}

/** 1. Consumption forecast + 2. dynamic reorder level (ROP = d·L + z·σd·√L) */
export async function materialForecast(months = 12, horizon = 3) {
  const [{ keys, by }, lt, stock, mats] = await Promise.all([
    monthlyConsumption(months), leadTimes(), stockByMaterial(),
    prisma.rawMaterial.findMany({ where: { status: 'ACTIVE' } }),
  ]);
  const z = 1.65; // 95 % service level
  const out = mats.map((m) => {
    const series = keys.map((k) => by.get(m.id)?.get(k) ?? 0);
    const { forecast, sigma } = holt(series, horizon);
    const daily = mean(series) / 30;
    const sigmaDaily = std(series) / 30;
    const L = lt.get(m.id) ?? 14;
    const safety = z * sigmaDaily * Math.sqrt(L);
    const rop = daily * L + safety;
    const usable = Number(stock.get(m.id)?.usable ?? 0);
    const monthlyF = forecast[0] || 0;
    return {
      rawMaterialId: m.id, code: m.code, name: m.name, uom: m.uom,
      history: keys.map((k, i) => ({ month: k, qty: series[i] })),
      forecast: forecast.map((q, i) => ({ month: monthKey(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + i + 1, 1))), qty: +q.toFixed(3), low: +Math.max(0, q - 1.28 * sigma).toFixed(3), high: +(q + 1.28 * sigma).toFixed(3) })),
      leadTimeDays: +L.toFixed(1),
      currentReorderLevel: Number(m.reorderLevel), recommendedReorderLevel: +rop.toFixed(3), safetyStock: +safety.toFixed(3),
      onHand: usable, daysOfCover: monthlyF > 0 ? +((usable / monthlyF) * 30).toFixed(1) : null,
      action: rop > 0 && usable <= rop ? 'ORDER_NOW' : Math.abs(rop - Number(m.reorderLevel)) > 0.25 * Math.max(rop, 1) && series.some((x) => x > 0) ? 'REVISE_REORDER_LEVEL' : 'OK',
    };
  });
  return out.filter((o) => o.history.some((h) => h.qty > 0) || o.currentReorderLevel > 0);
}

/** 3. Future production needs: open work orders exploded through approved BOMs vs stock + open POs. */
export async function productionNeeds() {
  const wos = await prisma.workOrder.findMany({ where: { status: { in: ['PLANNED', 'SCHEDULED', 'IN_PROGRESS'] } }, include: { product: true } });
  const need = new Map<string, number>();
  for (const wo of wos) {
    const f = await prisma.formula.findFirst({ where: { productId: wo.productId, status: 'APPROVED' }, include: { items: { include: { rawMaterial: true } } } });
    if (!f) continue;
    const scale = Number(wo.quantity) / Number(f.baseBatchSize);
    for (const it of f.items) {
      // normalise to material UOM using simple mass/volume factors
      const factor = it.unit.toUpperCase() === it.rawMaterial.uom.toUpperCase() ? 1 : ({ 'G>KG': 0.001, 'KG>G': 1000, 'MG>KG': 1e-6, 'MG>G': 0.001, 'ML>L': 0.001, 'L>ML': 1000 } as any)[`${it.unit.toUpperCase()}>${it.rawMaterial.uom.toUpperCase()}`] ?? 1;
      need.set(it.rawMaterialId, (need.get(it.rawMaterialId) ?? 0) + Number(it.quantity) * scale * (1 + Number(it.wastagePct) / 100) * factor);
    }
  }
  const [stock, onOrder, mats] = await Promise.all([
    stockByMaterial(),
    prisma.purchaseOrderItem.groupBy({ by: ['rawMaterialId'], where: { po: { status: { in: ['APPROVED', 'PARTIALLY_RECEIVED'] } } }, _sum: { quantity: true, receivedQty: true } }),
    prisma.rawMaterial.findMany({ where: { id: { in: [...need.keys()] } } }),
  ]);
  const oo = new Map(onOrder.map((o) => [o.rawMaterialId, Number(o._sum.quantity ?? 0) - Number(o._sum.receivedQty ?? 0)]));
  return {
    openWorkOrders: wos.length,
    materials: mats.map((m) => {
      const req = need.get(m.id) ?? 0, have = Number(stock.get(m.id)?.usable ?? 0), inbound = oo.get(m.id) ?? 0;
      return { code: m.code, name: m.name, uom: m.uom, required: +req.toFixed(3), onHand: have, onOrder: +inbound.toFixed(3), shortfall: +Math.max(0, req - have - inbound).toFixed(3) };
    }).sort((a, b) => b.shortfall - a.shortfall),
  };
}

/** 4. Expiry risk: FEFO simulation — how much of each lot will still be on the shelf when it expires? */
export async function expiryRisk() {
  const { keys, by } = await monthlyConsumption(6);
  const lots = await prisma.materialLot.findMany({ where: { status: 'APPROVED', availableQty: { gt: 0 }, expiryDate: { not: null } }, include: { rawMaterial: true }, orderBy: { expiryDate: 'asc' } });
  const byMat = new Map<string, typeof lots>();
  lots.forEach((l) => byMat.set(l.rawMaterialId, [...(byMat.get(l.rawMaterialId) ?? []), l]));
  const risks: any[] = [];
  for (const [rid, ls] of byMat) {
    const daily = mean(keys.map((k) => by.get(rid)?.get(k) ?? 0)) / 30;
    let cumulative = 0; // stock ahead of this lot in FEFO order
    for (const l of ls) {
      const daysLeft = Math.max(0, (l.expiryDate!.getTime() - Date.now()) / day);
      const demandBeforeExpiry = daily * daysLeft;
      const consumedFromThisLot = Math.max(0, Math.min(Number(l.availableQty), demandBeforeExpiry - cumulative));
      const atRisk = Number(l.availableQty) - consumedFromThisLot;
      cumulative += Number(l.availableQty);
      if (atRisk > 0) risks.push({ lotId: l.id, code: l.rawMaterial.code, material: l.rawMaterial.name, lotNumber: l.lotNumber, expiryDate: l.expiryDate, daysLeft: Math.round(daysLeft), onHand: Number(l.availableQty), projectedUnused: +atRisk.toFixed(3), valueAtRisk: +(atRisk * Number(l.unitCost)).toFixed(2), uom: l.rawMaterial.uom, riskPct: +((atRisk / Number(l.availableQty)) * 100).toFixed(0) });
    }
  }
  return risks.sort((a, b) => b.valueAtRisk - a.valueAtRisk).slice(0, 30);
}

/** 5. Supplier performance: OTIF, quality, price stability → weighted score. */
export async function supplierScores() {
  const suppliers = await prisma.supplier.findMany({ where: { isActive: true } });
  const out = [];
  for (const s of suppliers) {
    const [grns, poItems, lots, prices] = await Promise.all([
      prisma.grn.findMany({ where: { supplierId: s.id, poId: { not: null } }, include: { po: true } }),
      prisma.purchaseOrderItem.findMany({ where: { po: { supplierId: s.id, status: { in: ['RECEIVED', 'PARTIALLY_RECEIVED', 'CLOSED'] } } } }),
      prisma.materialLot.findMany({ where: { supplierId: s.id }, select: { status: true, receivedQty: true } }),
      prisma.supplierPrice.findMany({ where: { supplierId: s.id }, orderBy: { effectiveDate: 'asc' } }),
    ]);
    const onTime = grns.length ? grns.filter((g) => !g.po?.expectedDate || g.receivedAt <= new Date(g.po.expectedDate.getTime() + day)).length / grns.length : null;
    const ordered = poItems.reduce((a, i) => a + Number(i.quantity), 0);
    const fill = ordered ? Math.min(1, poItems.reduce((a, i) => a + Number(i.receivedQty), 0) / ordered) : null;
    const quality = lots.length ? lots.filter((l) => l.status !== 'REJECTED').length / lots.length : null;
    const byMat = new Map<string, number[]>();
    prices.forEach((p) => byMat.set(p.rawMaterialId, [...(byMat.get(p.rawMaterialId) ?? []), Number(p.price)]));
    const cv = [...byMat.values()].filter((a) => a.length > 2).map((a) => std(a) / (mean(a) || 1));
    const stability = cv.length ? Math.max(0, 1 - mean(cv) * 4) : null;
    const parts = [[onTime, 0.35], [fill, 0.2], [quality, 0.3], [stability, 0.15]].filter(([v]) => v !== null) as [number, number][];
    const wsum = parts.reduce((a, [, w]) => a + w, 0);
    const score = wsum ? Math.round((parts.reduce((a, [v, w]) => a + v * w, 0) / wsum) * 100) : null;
    out.push({
      supplierId: s.id, code: s.code, name: s.name, score, grade: score === null ? 'N/A' : score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D',
      onTimePct: onTime !== null ? Math.round(onTime * 100) : null, fillRatePct: fill !== null ? Math.round(fill * 100) : null,
      qualityPct: quality !== null ? Math.round(quality * 100) : null, priceStabilityPct: stability !== null ? Math.round(stability * 100) : null,
      risk: score !== null && score < 70 ? 'HIGH' : score !== null && score < 85 ? 'MEDIUM' : 'LOW', deliveries: grns.length,
    });
  }
  return out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

export async function analyticsBundle() {
  const [materials, needs, risk, suppliers] = await Promise.all([materialForecast(), productionNeeds(), expiryRisk(), supplierScores()]);
  return {
    generatedAt: new Date(), materials, productionNeeds: needs, expiryRisk: risk, suppliers,
    totals: { valueAtRisk: risk.reduce((a, r) => a + r.valueAtRisk, 0), orderNow: materials.filter((m) => m.action === 'ORDER_NOW').length, shortfalls: needs.materials.filter((m) => m.shortfall > 0).length },
  };
}
export { D };
