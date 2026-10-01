import { env } from '../config/env';
import { conflict, notFound } from '../lib/errors';
import { D, basePrisma, prisma, transaction } from '../lib/prisma';
import { nextNumber } from '../lib/sequence';
import { notify, notifyRoles } from '../lib/notify';
import { stockByMaterial } from './inventory.service';
import { daysBetween } from './dates';

const day = 86_400_000;

export async function expiryOverview(withinDays = env.EXPIRY_WARNING_DAYS) {
  const now = new Date();
  const horizon = new Date(now.getTime() + withinDays * day);
  const [matNear, matExpired, fgNear, fgExpired] = await Promise.all([
    prisma.materialLot.findMany({ where: { availableQty: { gt: 0 }, expiryDate: { gt: now, lte: horizon }, status: { in: ['APPROVED', 'QUARANTINE'] } }, include: { rawMaterial: true, warehouse: true }, orderBy: { expiryDate: 'asc' } }),
    prisma.materialLot.findMany({ where: { availableQty: { gt: 0 }, OR: [{ status: 'EXPIRED' }, { expiryDate: { lte: now } }] }, include: { rawMaterial: true, warehouse: true }, orderBy: { expiryDate: 'desc' } }),
    prisma.finishedGoodLot.findMany({ where: { availableQty: { gt: 0 }, expiryDate: { gt: now, lte: horizon }, status: { in: ['RELEASED', 'QUARANTINE'] } }, include: { product: true, batch: { select: { batchNumber: true } } }, orderBy: { expiryDate: 'asc' } }),
    prisma.finishedGoodLot.findMany({ where: { availableQty: { gt: 0 }, OR: [{ status: 'EXPIRED' }, { expiryDate: { lte: now } }] }, include: { product: true, batch: { select: { batchNumber: true } } }, orderBy: { expiryDate: 'desc' } }),
  ]);
  const bucket = (d: Date) => { const n = daysBetween(now, d); return n <= 30 ? '≤30' : n <= 60 ? '31-60' : '61-90+'; };
  return {
    withinDays,
    summary: {
      rawMaterialNearExpiry: matNear.length, rawMaterialExpired: matExpired.length, finishedGoodsNearExpiry: fgNear.length, finishedGoodsExpired: fgExpired.length,
      buckets: { '≤30': 0, '31-60': 0, '61-90+': 0, ...matNear.concat(fgNear as any).reduce((a: any, l: any) => ((a[bucket(l.expiryDate)] = (a[bucket(l.expiryDate)] ?? 0) + 1), a), {}) },
    },
    rawMaterialNearExpiry: matNear.map((l) => ({ ...l, daysLeft: daysBetween(now, l.expiryDate!) })),
    rawMaterialExpired: matExpired,
    finishedGoodsNearExpiry: fgNear.map((l) => ({ ...l, daysLeft: daysBetween(now, l.expiryDate) })),
    finishedGoodsExpired: fgExpired,
  };
}

/** Nightly job: expire lots, raise expiry/low-stock/pending-approval notifications (de-duplicated). */
export async function runSweep() {
  const now = new Date();
  const stats = { expiredLots: 0, expiredFg: 0, warnings: 0, lowStock: 0, pending: 0 };

  // 1. Auto-expire (status only — physical write-off is a deliberate, audited action)
  const expiredLots = await basePrisma.materialLot.findMany({ where: { expiryDate: { lte: now }, status: { in: ['APPROVED', 'QUARANTINE'] }, availableQty: { gt: 0 } }, include: { rawMaterial: true } });
  for (const l of expiredLots) {
    await prisma.materialLot.update({ where: { id: l.id }, data: { status: 'EXPIRED' } }); // audited as a system action
    await notifyRoles(['WAREHOUSE_MANAGER', 'QC_MANAGER'], { type: 'EXPIRED', severity: 'CRITICAL', title: 'Raw material expired', message: `${l.rawMaterial.code} lot ${l.lotNumber} (${l.availableQty} ${l.rawMaterial.uom}) expired on ${l.expiryDate!.toISOString().slice(0, 10)}. Segregate and dispose.`, link: '/expiry', dedupeKey: `EXP:${l.id}` });
    stats.expiredLots++;
  }
  const expiredFg = await basePrisma.finishedGoodLot.findMany({ where: { expiryDate: { lte: now }, status: { in: ['RELEASED', 'QUARANTINE'] }, availableQty: { gt: 0 } }, include: { product: true, batch: true } });
  for (const l of expiredFg) {
    await prisma.finishedGoodLot.update({ where: { id: l.id }, data: { status: 'EXPIRED' } });
    await notifyRoles(['WAREHOUSE_MANAGER', 'QC_MANAGER'], { type: 'EXPIRED', severity: 'CRITICAL', title: 'Finished goods expired', message: `${l.product.name} batch ${l.batch.batchNumber} expired.`, link: '/expiry', dedupeKey: `EXPFG:${l.id}` });
    stats.expiredFg++;
  }

  // 2. Near-expiry warnings (30/60/90 day escalation, one notification per bucket per lot)
  for (const b of [30, 60, 90]) {
    const lots = await basePrisma.materialLot.findMany({ where: { status: { in: ['APPROVED', 'QUARANTINE'] }, availableQty: { gt: 0 }, expiryDate: { gt: now, lte: new Date(now.getTime() + b * day) } }, include: { rawMaterial: true } });
    for (const l of lots) {
      await notifyRoles(['WAREHOUSE_MANAGER', 'PURCHASE_MANAGER'], { type: 'EXPIRY_WARNING', severity: b <= 30 ? 'CRITICAL' : 'WARNING', title: `Expiring within ${b} days`, message: `${l.rawMaterial.code} lot ${l.lotNumber}: ${l.availableQty} ${l.rawMaterial.uom}, expires ${l.expiryDate!.toISOString().slice(0, 10)}.`, link: '/expiry', dedupeKey: `EXPW:${l.id}:${b}` });
      stats.warnings++;
    }
  }

  // 3. Low stock / reorder (weekly de-dupe so alerts re-fire if still unresolved)
  const week = `${now.getUTCFullYear()}-W${Math.ceil(((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / day + 1) / 7)}`;
  const stock = await stockByMaterial();
  const mats = await basePrisma.rawMaterial.findMany({ where: { status: 'ACTIVE' } });
  for (const m of mats) {
    const usable = stock.get(m.id)?.usable ?? D(0);
    if (m.minStock.gt(0) && usable.lte(m.minStock)) {
      await notifyRoles(['WAREHOUSE_MANAGER', 'PURCHASE_MANAGER'], { type: 'LOW_STOCK', severity: 'CRITICAL', title: 'Low stock', message: `${m.code} ${m.name}: ${usable} ${m.uom} on hand, minimum ${m.minStock}.`, link: '/raw-materials', dedupeKey: `LOW:${m.id}:${week}` });
      stats.lowStock++;
    } else if (m.reorderLevel.gt(0) && usable.lte(m.reorderLevel)) {
      await notifyRoles(['PURCHASE_MANAGER'], { type: 'REORDER_REQUIRED', severity: 'WARNING', title: 'Reorder required', message: `${m.code} ${m.name} is at ${usable} ${m.uom} (reorder level ${m.reorderLevel}).`, link: '/purchase', dedupeKey: `REO:${m.id}:${week}` });
      stats.lowStock++;
    }
  }

  // 4. Approvals stuck for > 24 h
  const stale = new Date(now.getTime() - day);
  const samples = await basePrisma.qcSample.count({ where: { status: { in: ['PENDING', 'IN_TESTING'] }, collectedAt: { lt: stale } } });
  if (samples) { await notify({ type: 'QC_APPROVAL_PENDING', severity: 'WARNING', title: 'QC backlog', message: `${samples} QC sample(s) have been waiting more than 24 hours.`, targetRole: 'QC_MANAGER', link: '/qc', dedupeKey: `QCBL:${now.toISOString().slice(0, 10)}` }); stats.pending++; }
  const rel = await basePrisma.batch.count({ where: { status: 'QC_REVIEW', qcStatus: 'PASSED' } });
  if (rel) { await notify({ type: 'BATCH_RELEASE_PENDING', severity: 'WARNING', title: 'Batches awaiting release', message: `${rel} batch(es) passed QC and await release.`, targetRole: 'QC_MANAGER', link: '/batches', dedupeKey: `RELBL:${now.toISOString().slice(0, 10)}` }); stats.pending++; }
  return stats;
}

// ───────────── Write-off & recall ─────────────

export async function writeOffExpiredLot(lotId: string, userId: string, reason = 'Expired — disposed') {
  return transaction(async (tx) => {
    const lot = await tx.materialLot.findUnique({ where: { id: lotId } });
    if (!lot) throw notFound('Lot not found');
    if (lot.expiryDate && lot.expiryDate > new Date() && lot.status !== 'EXPIRED' && lot.status !== 'REJECTED') throw conflict('Only expired/rejected lots can be written off');
    if (lot.availableQty.lte(0)) throw conflict('Lot has no stock');
    await tx.materialLot.update({ where: { id: lotId }, data: { availableQty: 0, status: lot.status === 'REJECTED' ? 'REJECTED' : 'EXPIRED' } });
    return tx.stockMovement.create({ data: { type: 'WRITE_OFF', materialLotId: lotId, quantity: lot.availableQty.neg(), balanceAfter: 0, unitCost: lot.unitCost, reference: await nextNumber(tx, 'WO'), reason, userId } });
  });
}

/** Recall: locks the FG lot, computes dispatched quantity and the customers to contact. */
export async function initiateRecall(batchId: string, reason: string, classification: string, userId: string) {
  const out = await transaction(async (tx) => {
    const batch = await tx.batch.findUnique({ where: { id: batchId }, include: { product: true, fgLot: { include: { dispatchItems: { include: { dispatch: true } } } } } });
    if (!batch) throw notFound('Batch not found');
    const dispatched = batch.fgLot?.dispatchItems.reduce((s, d) => s.add(d.quantity), D(0)) ?? D(0);
    if (batch.fgLot) await tx.finishedGoodLot.update({ where: { id: batch.fgLot.id }, data: { status: 'RECALLED', reservedQty: 0 } });
    const recall = await tx.recall.create({ data: { recallNumber: await nextNumber(tx, 'RCL'), batchId, reason, classification, quantityDispatched: dispatched, initiatedById: userId } });
    const customers = [...new Set(batch.fgLot?.dispatchItems.map((d) => d.dispatch.customer) ?? [])];
    return { recall, customers, batch };
  });
  await notifyRoles(['SUPER_ADMIN', 'QC_MANAGER', 'WAREHOUSE_MANAGER', 'PRODUCTION_MANAGER'], { type: 'RECALL', severity: 'CRITICAL', title: `Recall ${out.recall.recallNumber}`, message: `${out.batch.product.name} batch ${out.batch.batchNumber}: ${reason}. Customers affected: ${out.customers.join(', ') || 'none dispatched'}.`, link: '/expiry', dedupeKey: `RCL:${out.recall.id}` });
  return { ...out, customers: out.customers };
}
