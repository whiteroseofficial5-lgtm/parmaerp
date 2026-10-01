import { BatchStatus, Prisma, Role } from '@prisma/client';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { D, prisma, transaction, Tx } from '../lib/prisma';
import { convertQty } from '../lib/uom';
import { nextNumber } from '../lib/sequence';
import { notifyRoles } from '../lib/notify';
import { sign } from '../lib/signature';
import { allocateFefo, deductFromLot } from './inventory.service';
import { effectiveFormula } from './formula.service';
import { expiryFrom } from './dates';

export interface CreateBatchInput {
  productId: string;
  batchSize: number | string;
  mfgDate?: Date;
  operatorId?: string;
  workOrderId?: string;
  remarks?: string;
  batchNumber?: string;
}

async function nextBatchNumber(tx: Tx, productCode: string, mfg: Date) {
  const yymm = `${String(mfg.getUTCFullYear()).slice(2)}${String(mfg.getUTCMonth() + 1).padStart(2, '0')}`;
  const name = `BN-${productCode}-${yymm}`;
  const row = await (tx as any).sequence.upsert({ where: { name }, create: { name, value: 1 }, update: { value: { increment: 1 } } });
  return `${productCode}-${yymm}-${String(row.value).padStart(3, '0')}`;
}

export async function createBatch(input: CreateBatchInput, userId: string) {
  return transaction(async (tx) => {
    const formula = await effectiveFormula(input.productId);
    if (!formula) throw badRequest('This product has no APPROVED formula — a batch cannot be planned');
    const size = D(input.batchSize);
    if (size.lte(0)) throw badRequest('Batch size must be greater than zero');
    const mfg = input.mfgDate ?? new Date();
    const scale = size.div(formula.baseBatchSize);

    const batchNumber = input.batchNumber ?? (await nextBatchNumber(tx, formula.product.code, mfg));
    if (await tx.batch.findUnique({ where: { batchNumber } })) throw conflict(`Batch number ${batchNumber} already exists`);

    const batch = await tx.batch.create({
      data: {
        batchNumber, productId: input.productId, formulaId: formula.id, batchSize: size, batchUnit: formula.baseBatchUnit,
        mfgDate: mfg, expiryDate: expiryFrom(mfg, formula.product.shelfLifeMonths),
        theoreticalYield: size, operatorId: input.operatorId, workOrderId: input.workOrderId, remarks: input.remarks, createdById: userId,
        materials: {
          create: formula.items.map((it) => ({
            rawMaterialId: it.rawMaterialId, unit: it.rawMaterial.uom,
            requiredQty: convertQty(it.quantity.mul(scale).mul(D(1).add(it.wastagePct.div(100))), it.unit, it.rawMaterial.uom),
          })),
        },
        history: { create: { toStatus: 'DRAFT', userId, remarks: 'Batch created' } },
      },
    });
    await sign(tx, userId, 'Batch', batch.id, 'Prepared by');
    return batch;
  });
}

const ALLOWED: Record<BatchStatus, BatchStatus[]> = {
  DRAFT: ['APPROVED', 'CANCELLED'],
  APPROVED: ['IN_PRODUCTION', 'CANCELLED'],
  IN_PRODUCTION: ['QC_REVIEW'],
  QC_REVIEW: ['RELEASED', 'REJECTED'],
  RELEASED: [],
  REJECTED: [],
  CANCELLED: [],
};

async function log(tx: Tx, batchId: string, from: BatchStatus, to: BatchStatus, userId: string, remarks?: string) {
  await tx.batchStatusHistory.create({ data: { batchId, fromStatus: from, toStatus: to, userId, remarks } });
  await tx.batch.update({ where: { id: batchId }, data: { status: to } });
}

async function load(tx: Tx, id: string) {
  const b = await tx.batch.findUnique({ where: { id }, include: { product: true, formula: true, materials: { include: { rawMaterial: true } } } });
  if (!b) throw notFound('Batch not found');
  return b;
}
const guard = (b: { status: BatchStatus }, to: BatchStatus) => {
  if (!ALLOWED[b.status].includes(to)) throw conflict(`Invalid transition ${b.status} → ${to}`);
};

// DRAFT → APPROVED
export async function approveBatch(id: string, userId: string, role: Role, remarks?: string) {
  return transaction(async (tx) => {
    const b = await load(tx, id);
    guard(b, 'APPROVED');
    if (b.createdById === userId && role !== 'SUPER_ADMIN') throw forbidden('Segregation of duties: the batch author cannot approve it');
    const f = await tx.formula.findUnique({ where: { id: b.formulaId } });
    if (f?.status === 'OBSOLETE') throw conflict('The formula used by this batch has been superseded — recreate the batch with the current version');

    // Pre-flight material availability (informational block: real deduction happens at start).
    const short: string[] = [];
    for (const m of b.materials) {
      const agg = await tx.materialLot.aggregate({
        where: { rawMaterialId: m.rawMaterialId, status: 'APPROVED', availableQty: { gt: 0 }, OR: [{ expiryDate: null }, { expiryDate: { gt: new Date() } }] },
        _sum: { availableQty: true },
      });
      const avail = agg._sum.availableQty ?? D(0);
      if (avail.lt(m.requiredQty)) short.push(`${m.rawMaterial.code}: need ${m.requiredQty} ${m.unit}, usable ${avail}`);
    }
    if (short.length) throw conflict('Insufficient approved stock for this batch', short);

    await log(tx, id, b.status, 'APPROVED', userId, remarks);
    await sign(tx, userId, 'Batch', id, 'Approved by');
    return tx.batch.findUniqueOrThrow({ where: { id } });
  });
}

// APPROVED → IN_PRODUCTION  (deduct raw materials FEFO, record consumption)
export async function startProduction(id: string, userId: string) {
  return transaction(async (tx) => {
    const b = await load(tx, id);
    guard(b, 'IN_PRODUCTION');
    let totalCost = D(0);
    for (const m of b.materials) {
      const allocs = await allocateFefo(tx, m.rawMaterialId, m.requiredQty);
      let cost = D(0);
      for (const a of allocs) {
        await deductFromLot(tx, { lotId: a.lotId, quantity: a.quantity, type: 'CONSUMPTION', reference: b.batchNumber, reason: 'Batch consumption', userId });
        await tx.batchMaterialConsumption.create({ data: { batchMaterialId: m.id, materialLotId: a.lotId, quantity: a.quantity, unitCost: a.unitCost } });
        cost = cost.add(a.quantity.mul(a.unitCost));
      }
      totalCost = totalCost.add(cost);
      await tx.batchMaterial.update({ where: { id: m.id }, data: { issuedQty: m.requiredQty, unitCostAvg: m.requiredQty.gt(0) ? cost.div(m.requiredQty) : 0 } });
    }
    await tx.batch.update({ where: { id }, data: { startedAt: new Date(), materialCost: totalCost } });
    await log(tx, id, b.status, 'IN_PRODUCTION', userId, 'Raw materials issued (FEFO)');
    if (b.workOrderId) await tx.workOrder.update({ where: { id: b.workOrderId }, data: { status: 'IN_PROGRESS', actualStart: new Date() } });
    return tx.batch.findUniqueOrThrow({ where: { id } });
  });
}

export interface CompleteInput {
  actualYield: number | string;
  finishedGoodsWarehouseId: string;
  binId?: string;
  remarks?: string;
  /** Optional actual issued quantities that differ from planned (recorded, not re-deducted). */
  actualConsumption?: { rawMaterialId: string; actualQty: number | string }[];
}

// IN_PRODUCTION → QC_REVIEW (record output, yield, cost; quarantine FG; create QC sample)
export async function completeProduction(id: string, input: CompleteInput, userId: string) {
  return transaction(async (tx) => {
    const b = await load(tx, id);
    guard(b, 'QC_REVIEW');
    const actual = D(input.actualYield);
    if (actual.lte(0)) throw badRequest('Actual yield must be greater than zero');
    const theoretical = b.theoreticalYield ?? b.batchSize;
    if (actual.gt(theoretical.mul(1.05))) throw badRequest(`Actual yield ${actual} exceeds theoretical ${theoretical} by more than 5% — verify counts`);
    const yieldPct = actual.div(theoretical).mul(100);
    const wastagePct = Prisma.Decimal.max(D(100).sub(yieldPct), D(0));

    for (const ac of input.actualConsumption ?? []) {
      await tx.batchMaterial.updateMany({ where: { batchId: id, rawMaterialId: ac.rawMaterialId }, data: { issuedQty: D(ac.actualQty) } });
    }
    const cost = b.materialCost ?? D(0);
    await tx.batch.update({
      where: { id },
      data: {
        actualYield: actual, yieldPct: yieldPct.toDecimalPlaces(3), wastagePct: wastagePct.toDecimalPlaces(3),
        costPerUnit: cost.div(actual).toDecimalPlaces(6), completedAt: new Date(), qcStatus: 'PENDING',
        remarks: input.remarks ?? b.remarks,
      },
    });

    // Finished goods enter QUARANTINE; they only become saleable after QC release.
    const fg = await tx.finishedGoodLot.create({
      data: {
        batchId: id, productId: b.productId, warehouseId: input.finishedGoodsWarehouseId, binId: input.binId,
        producedQty: actual, availableQty: actual, mfgDate: b.mfgDate, expiryDate: b.expiryDate, status: 'QUARANTINE',
      },
    });
    await tx.stockMovement.create({
      data: { type: 'PRODUCTION_OUTPUT', fgLotId: fg.id, quantity: actual, balanceAfter: actual, toWarehouseId: input.finishedGoodsWarehouseId, reference: b.batchNumber, userId },
    });

    const sampleNumber = await nextNumber(tx, 'QS');
    await tx.qcSample.create({ data: { sampleNumber, type: 'FINISHED_PRODUCT', batchId: id, status: 'PENDING', collectedById: userId } });

    await log(tx, id, b.status, 'QC_REVIEW', userId, `Yield ${yieldPct.toFixed(2)}%`);
    await sign(tx, userId, 'Batch', id, 'Manufactured by');
    if (b.workOrderId) await tx.workOrder.update({ where: { id: b.workOrderId }, data: { status: 'COMPLETED', actualEnd: new Date(), progressPct: 100 } });

    await notifyRoles(['QC_MANAGER'], {
      type: 'QC_APPROVAL_PENDING', severity: 'WARNING', title: 'Batch awaiting QC review',
      message: `${b.product.name} batch ${b.batchNumber} completed (yield ${yieldPct.toFixed(1)}%).`, link: `/batches/${id}`, dedupeKey: `QCB:${id}`,
    });
    const expected = (await tx.formula.findUnique({ where: { id: b.formulaId } }))?.expectedYieldPct ?? D(98);
    if (yieldPct.lt(expected.sub(3))) {
      await notifyRoles(['PRODUCTION_MANAGER', 'QC_MANAGER'], {
        type: 'SYSTEM', severity: 'CRITICAL', title: 'Yield deviation',
        message: `Batch ${b.batchNumber}: yield ${yieldPct.toFixed(1)}% vs expected ${expected}%. Investigate before release.`, link: `/batches/${id}`, dedupeKey: `YLD:${id}`,
      });
    }
    return tx.batch.findUniqueOrThrow({ where: { id } });
  });
}

// QC_REVIEW → RELEASED
export async function releaseBatch(id: string, userId: string, remarks?: string) {
  return transaction(async (tx) => {
    const b = await load(tx, id);
    guard(b, 'RELEASED');
    const samples = await tx.qcSample.findMany({ where: { batchId: id } });
    if (!samples.length || samples.some((s) => s.status !== 'PASSED') || b.qcStatus !== 'PASSED') {
      throw conflict('Batch cannot be released: all QC samples must be PASSED');
    }
    await tx.batch.update({ where: { id }, data: { releasedAt: new Date() } });
    await tx.finishedGoodLot.update({ where: { batchId: id }, data: { status: 'RELEASED' } });
    await log(tx, id, b.status, 'RELEASED', userId, remarks ?? 'QC released');
    await sign(tx, userId, 'Batch', id, 'QC Released by');
    return tx.batch.findUniqueOrThrow({ where: { id } });
  });
}

export async function rejectBatch(id: string, userId: string, remarks: string) {
  if (!remarks?.trim()) throw badRequest('A rejection reason is required');
  return transaction(async (tx) => {
    const b = await load(tx, id);
    guard(b, 'REJECTED');
    const fg = await tx.finishedGoodLot.findUnique({ where: { batchId: id } });
    if (fg) {
      await tx.finishedGoodLot.update({ where: { id: fg.id }, data: { status: 'DEPLETED', availableQty: 0 } });
      await tx.stockMovement.create({ data: { type: 'WRITE_OFF', fgLotId: fg.id, quantity: fg.availableQty.neg(), balanceAfter: 0, reference: b.batchNumber, reason: `QC rejected: ${remarks}`, userId } });
    }
    await tx.batch.update({ where: { id }, data: { qcStatus: 'FAILED' } });
    await log(tx, id, b.status, 'REJECTED', userId, remarks);
    return tx.batch.findUniqueOrThrow({ where: { id } });
  });
}

export async function cancelBatch(id: string, userId: string, remarks?: string) {
  return transaction(async (tx) => {
    const b = await load(tx, id);
    guard(b, 'CANCELLED');
    await log(tx, id, b.status, 'CANCELLED', userId, remarks);
    return tx.batch.findUniqueOrThrow({ where: { id } });
  });
}

// ───────────── Read models ─────────────

export const batchDetailInclude = {
  product: true,
  formula: { include: { items: { include: { rawMaterial: true } } } },
  operator: { select: { id: true, name: true } },
  materials: { include: { rawMaterial: true, consumptions: { include: { materialLot: { select: { lotNumber: true, supplierLot: true, expiryDate: true, supplier: { select: { name: true } } } } } } } },
  history: { orderBy: { createdAt: 'asc' as const } },
  fgLot: true,
  qcSamples: { include: { results: true } },
  workOrder: true,
};

/** Public-safe traceability view used by the QR landing page (no costs, no personnel). */
export async function traceBatch(batchNumber: string) {
  const b = await prisma.batch.findUnique({
    where: { batchNumber },
    include: {
      product: { select: { name: true, code: true, dosageForm: true, strength: true } },
      materials: { include: { rawMaterial: { select: { name: true, code: true } }, consumptions: { include: { materialLot: { select: { lotNumber: true, supplierLot: true, expiryDate: true, supplier: { select: { name: true } } } } } } } },
      history: { orderBy: { createdAt: 'asc' }, select: { toStatus: true, createdAt: true } },
      fgLot: { select: { status: true, expiryDate: true } },
      qcSamples: { select: { sampleNumber: true, type: true, status: true, completedAt: true } },
      recalls: { select: { recallNumber: true, status: true, reason: true } },
    },
  });
  if (!b) throw notFound('Batch not found');
  return {
    batchNumber: b.batchNumber, product: b.product, mfgDate: b.mfgDate, expiryDate: b.expiryDate, batchSize: b.batchSize, batchUnit: b.batchUnit,
    status: b.status, qcStatus: b.qcStatus, yieldPct: b.yieldPct, releasedAt: b.releasedAt,
    isExpired: b.expiryDate < new Date(), recalled: b.recalls.some((r) => r.status !== 'CLOSED') || b.fgLot?.status === 'RECALLED',
    rawMaterialHistory: b.materials.map((m) => ({
      material: m.rawMaterial.name, code: m.rawMaterial.code, quantity: m.issuedQty, unit: m.unit,
      lots: m.consumptions.map((c) => ({ lotNumber: c.materialLot.lotNumber, supplierLot: c.materialLot.supplierLot, supplier: c.materialLot.supplier?.name, expiry: c.materialLot.expiryDate, quantity: c.quantity })),
    })),
    productionHistory: b.history, qcHistory: b.qcSamples, recalls: b.recalls,
  };
}

/** Where-used: which batches consumed a given raw-material lot (backward → forward trace for recalls). */
export async function batchesUsingLot(materialLotId: string) {
  const rows = await prisma.batchMaterialConsumption.findMany({
    where: { materialLotId },
    include: { batchMaterial: { include: { batch: { include: { product: true, fgLot: true } } } } },
  });
  return rows.map((r) => ({ batchNumber: r.batchMaterial.batch.batchNumber, product: r.batchMaterial.batch.product.name, quantity: r.quantity, status: r.batchMaterial.batch.status, fgStatus: r.batchMaterial.batch.fgLot?.status }));
}
