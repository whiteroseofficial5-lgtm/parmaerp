import { LotStatus, MovementType, Prisma } from '@prisma/client';
import { addMonths } from './dates';
import { badRequest, conflict, notFound } from '../lib/errors';
import { D, prisma, Tx } from '../lib/prisma';
import { nextNumber } from '../lib/sequence';
import { notifyRoles } from '../lib/notify';

// ───────────── Receiving ─────────────

export interface ReceiveInput {
  rawMaterialId: string;
  lotNumber: string;
  supplierLot?: string | null;
  supplierId?: string | null;
  warehouseId: string;
  binId?: string | null;
  quantity: Prisma.Decimal | number | string;
  unitCost: Prisma.Decimal | number | string;
  mfgDate?: Date | null;
  expiryDate?: Date | null;
  coaDocumentId?: string | null;
  grnItemId?: string | null;
  reference: string;
  userId?: string;
  /** Lots normally enter QUARANTINE until QC approves. Opening balances may bypass. */
  status?: LotStatus;
  createQcSample?: boolean;
}

export async function receiveLot(tx: Tx, i: ReceiveInput) {
  const qty = D(i.quantity);
  if (qty.lte(0)) throw badRequest('Received quantity must be greater than zero');

  const material = await tx.rawMaterial.findUnique({ where: { id: i.rawMaterialId } });
  if (!material) throw notFound('Raw material not found');
  if (material.status !== 'ACTIVE') throw badRequest(`Material ${material.code} is ${material.status} and cannot be received`);

  const dup = await tx.materialLot.findUnique({
    where: { rawMaterialId_lotNumber: { rawMaterialId: i.rawMaterialId, lotNumber: i.lotNumber } },
  });
  if (dup) throw conflict(`Lot ${i.lotNumber} already exists for ${material.code}`);

  let expiry = i.expiryDate ?? null;
  if (!expiry && i.mfgDate && material.shelfLifeMonths) expiry = addMonths(i.mfgDate, material.shelfLifeMonths);
  if (expiry && expiry < new Date() && i.status !== 'EXPIRED') throw badRequest(`Lot ${i.lotNumber} is already expired (${expiry.toISOString().slice(0, 10)})`);

  const lot = await tx.materialLot.create({
    data: {
      rawMaterialId: i.rawMaterialId,
      lotNumber: i.lotNumber,
      supplierLot: i.supplierLot ?? undefined,
      supplierId: i.supplierId ?? undefined,
      warehouseId: i.warehouseId,
      binId: i.binId ?? undefined,
      receivedQty: qty,
      availableQty: qty,
      unitCost: D(i.unitCost),
      mfgDate: i.mfgDate ?? undefined,
      expiryDate: expiry ?? undefined,
      status: i.status ?? 'QUARANTINE',
      coaDocumentId: i.coaDocumentId ?? undefined,
      grnItemId: i.grnItemId ?? undefined,
      barcode: `LOT|${material.code}|${i.lotNumber}`,
    },
  });

  await tx.stockMovement.create({
    data: {
      type: 'RECEIPT', materialLotId: lot.id, quantity: qty, balanceAfter: qty, unitCost: D(i.unitCost),
      toWarehouseId: i.warehouseId, reference: i.reference, userId: i.userId,
    },
  });

  await tx.rawMaterial.update({ where: { id: material.id }, data: { purchasePrice: D(i.unitCost) } });
  if (i.supplierId) {
    await tx.supplierPrice.create({
      data: { supplierId: i.supplierId, rawMaterialId: material.id, price: D(i.unitCost), source: i.reference },
    });
  }

  if ((i.createQcSample ?? true) && (i.status ?? 'QUARANTINE') === 'QUARANTINE') {
    const sampleNumber = await nextNumber(tx, 'QS');
    await tx.qcSample.create({ data: { sampleNumber, type: 'RAW_MATERIAL', materialLotId: lot.id, status: 'PENDING', collectedById: i.userId } });
    await notifyRoles(['QC_MANAGER'], {
      type: 'QC_APPROVAL_PENDING', severity: 'WARNING',
      title: 'Raw material lot awaiting QC',
      message: `${material.code} lot ${lot.lotNumber} (${qty} ${material.uom}) received under ${i.reference}.`,
      link: '/qc', dedupeKey: `QCPEND:${lot.id}`,
    });
  }
  return lot;
}

// ───────────── Issue / consume (FEFO) ─────────────

export interface Allocation { lotId: string; lotNumber: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal }

/**
 * First-Expiry-First-Out allocation with pessimistic row locks (SELECT … FOR UPDATE)
 * so two concurrent batches can never over-consume the same lot.
 * Only APPROVED, non-expired lots are eligible (GMP: never use quarantined/rejected material).
 */
export async function allocateFefo(tx: Tx, rawMaterialId: string, needed: Prisma.Decimal, warehouseId?: string): Promise<Allocation[]> {
  const locked = warehouseId
    ? await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "MaterialLot"
        WHERE "rawMaterialId" = ${rawMaterialId} AND status = 'APPROVED' AND "availableQty" > 0
          AND ("expiryDate" IS NULL OR "expiryDate" > now()) AND "warehouseId" = ${warehouseId}
        ORDER BY "expiryDate" ASC NULLS LAST, "createdAt" ASC FOR UPDATE`
    : await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "MaterialLot"
        WHERE "rawMaterialId" = ${rawMaterialId} AND status = 'APPROVED' AND "availableQty" > 0
          AND ("expiryDate" IS NULL OR "expiryDate" > now())
        ORDER BY "expiryDate" ASC NULLS LAST, "createdAt" ASC FOR UPDATE`;

  const lots = await tx.materialLot.findMany({ where: { id: { in: locked.map((l) => l.id) } } });
  const order = new Map(locked.map((l, idx) => [l.id, idx]));
  lots.sort((a, b) => order.get(a.id)! - order.get(b.id)!);

  let remaining = needed;
  const out: Allocation[] = [];
  for (const lot of lots) {
    if (remaining.lte(0)) break;
    const take = Prisma.Decimal.min(lot.availableQty, remaining);
    out.push({ lotId: lot.id, lotNumber: lot.lotNumber, quantity: take, unitCost: lot.unitCost });
    remaining = remaining.sub(take);
  }
  if (remaining.gt(0)) {
    const m = await tx.rawMaterial.findUnique({ where: { id: rawMaterialId } });
    throw conflict(`Insufficient approved stock for ${m?.code} ${m?.name}: short by ${remaining} ${m?.uom}`, {
      rawMaterialId, shortage: remaining.toString(),
    });
  }
  return out;
}

/** Deduct a specific quantity from a specific lot, with a guard against negative stock, and write the ledger. */
export async function deductFromLot(
  tx: Tx,
  a: { lotId: string; quantity: Prisma.Decimal; type: MovementType; reference: string; reason?: string; userId?: string },
) {
  const res = await tx.materialLot.updateMany({
    where: { id: a.lotId, availableQty: { gte: a.quantity } },
    data: { availableQty: { decrement: a.quantity } },
  });
  if (res.count === 0) throw conflict('Insufficient lot balance (concurrent change?)');
  const lot = await tx.materialLot.findUniqueOrThrow({ where: { id: a.lotId } });
  if (lot.availableQty.lte(0) && lot.status === 'APPROVED') {
    await tx.materialLot.update({ where: { id: lot.id }, data: { status: 'DEPLETED' } });
  }
  await tx.stockMovement.create({
    data: {
      type: a.type, materialLotId: lot.id, quantity: a.quantity.neg(), balanceAfter: lot.availableQty,
      unitCost: lot.unitCost, fromWarehouseId: lot.warehouseId, reference: a.reference, reason: a.reason, userId: a.userId,
    },
  });
  return lot;
}

/** Manual stock-out (e.g. issue to lab, scrap, return-to-supplier). Caller picks the lot or FEFO is used. */
export async function stockOut(
  tx: Tx,
  i: { rawMaterialId: string; quantity: number | string; lotId?: string; reason: string; type?: MovementType; userId?: string },
) {
  const qty = D(i.quantity);
  if (qty.lte(0)) throw badRequest('Quantity must be greater than zero');
  const ref = await nextNumber(tx, 'ISS');
  const allocations = i.lotId
    ? [{ lotId: i.lotId, quantity: qty }]
    : await allocateFefo(tx, i.rawMaterialId, qty);
  for (const a of allocations) {
    await deductFromLot(tx, { lotId: a.lotId, quantity: a.quantity, type: i.type ?? 'ISSUE', reference: ref, reason: i.reason, userId: i.userId });
  }
  return { reference: ref, allocations: allocations.map((a) => ({ lotId: a.lotId, quantity: a.quantity.toString() })) };
}

// ───────────── Transfer & adjustment ─────────────

export async function transferLot(
  tx: Tx,
  i: { materialLotId: string; toWarehouseId: string; toBinId?: string; quantity?: number | string; reference?: string; userId?: string },
) {
  const lot = await tx.materialLot.findUnique({ where: { id: i.materialLotId } });
  if (!lot) throw notFound('Lot not found');
  const qty = i.quantity !== undefined ? D(i.quantity) : lot.availableQty;
  if (qty.lte(0) || qty.gt(lot.availableQty)) throw badRequest('Transfer quantity must be > 0 and ≤ available quantity');
  if (lot.warehouseId === i.toWarehouseId && (lot.binId ?? null) === (i.toBinId ?? null)) throw badRequest('Source and destination are the same');
  const ref = i.reference ?? (await nextNumber(tx, 'TRF'));

  let destLotId = lot.id;
  if (qty.eq(lot.availableQty)) {
    await tx.materialLot.update({ where: { id: lot.id }, data: { warehouseId: i.toWarehouseId, binId: i.toBinId ?? null } });
    await tx.stockMovement.createMany({
      data: [
        { type: 'TRANSFER_OUT', materialLotId: lot.id, quantity: qty.neg(), balanceAfter: 0, fromWarehouseId: lot.warehouseId, toWarehouseId: i.toWarehouseId, reference: ref, userId: i.userId },
        { type: 'TRANSFER_IN', materialLotId: lot.id, quantity: qty, balanceAfter: qty, fromWarehouseId: lot.warehouseId, toWarehouseId: i.toWarehouseId, reference: ref, userId: i.userId },
      ],
    });
  } else {
    // Partial transfer: split into a child lot that keeps the parent's identity (lot/S1) for traceability.
    const splits = await tx.materialLot.count({ where: { rawMaterialId: lot.rawMaterialId, lotNumber: { startsWith: `${lot.lotNumber}/S` } } });
    const child = await tx.materialLot.create({
      data: {
        rawMaterialId: lot.rawMaterialId, lotNumber: `${lot.lotNumber}/S${splits + 1}`, supplierLot: lot.supplierLot, supplierId: lot.supplierId,
        warehouseId: i.toWarehouseId, binId: i.toBinId, receivedQty: qty, availableQty: qty, unitCost: lot.unitCost,
        mfgDate: lot.mfgDate, expiryDate: lot.expiryDate, status: lot.status, coaDocumentId: lot.coaDocumentId,
        barcode: `LOT|${lot.rawMaterialId}|${lot.lotNumber}/S${splits + 1}`,
      },
    });
    destLotId = child.id;
    const src = await tx.materialLot.update({ where: { id: lot.id }, data: { availableQty: { decrement: qty } } });
    await tx.stockMovement.createMany({
      data: [
        { type: 'TRANSFER_OUT', materialLotId: lot.id, quantity: qty.neg(), balanceAfter: src.availableQty, fromWarehouseId: lot.warehouseId, toWarehouseId: i.toWarehouseId, reference: ref, userId: i.userId },
        { type: 'TRANSFER_IN', materialLotId: child.id, quantity: qty, balanceAfter: qty, fromWarehouseId: lot.warehouseId, toWarehouseId: i.toWarehouseId, reference: ref, userId: i.userId },
      ],
    });
  }
  return { reference: ref, destinationLotId: destLotId };
}

export async function adjustLot(tx: Tx, i: { materialLotId: string; newQuantity: number | string; reason: string; userId?: string; reference?: string }) {
  if (!i.reason || i.reason.trim().length < 5) throw badRequest('A reason (min 5 characters) is mandatory for stock adjustments');
  const lot = await tx.materialLot.findUnique({ where: { id: i.materialLotId } });
  if (!lot) throw notFound('Lot not found');
  const target = D(i.newQuantity);
  if (target.lt(0)) throw badRequest('Quantity cannot be negative');
  const delta = target.sub(lot.availableQty);
  if (delta.isZero()) return lot;
  const updated = await tx.materialLot.update({
    where: { id: lot.id },
    data: { availableQty: target, status: target.isZero() && lot.status === 'APPROVED' ? 'DEPLETED' : lot.status },
  });
  await tx.stockMovement.create({
    data: {
      type: 'ADJUSTMENT', materialLotId: lot.id, quantity: delta, balanceAfter: target, unitCost: lot.unitCost,
      reference: i.reference ?? (await nextNumber(tx, 'ADJ')), reason: i.reason, userId: i.userId,
    },
  });
  return updated;
}

// ───────────── Queries ─────────────

/** Usable / quarantined / total stock per raw material in a single grouped query. */
export async function stockByMaterial() {
  const rows = await prisma.materialLot.groupBy({
    by: ['rawMaterialId', 'status'],
    where: { availableQty: { gt: 0 } },
    _sum: { availableQty: true },
  });
  const map = new Map<string, { usable: Prisma.Decimal; quarantine: Prisma.Decimal; expired: Prisma.Decimal }>();
  for (const r of rows) {
    const e = map.get(r.rawMaterialId) ?? { usable: D(0), quarantine: D(0), expired: D(0) };
    const q = r._sum.availableQty ?? D(0);
    if (r.status === 'APPROVED') e.usable = e.usable.add(q);
    else if (r.status === 'QUARANTINE') e.quarantine = e.quarantine.add(q);
    else if (r.status === 'EXPIRED') e.expired = e.expired.add(q);
    map.set(r.rawMaterialId, e);
  }
  return map;
}

export function stockState(usable: Prisma.Decimal, min: Prisma.Decimal, reorder: Prisma.Decimal) {
  if (usable.lte(0)) return 'OUT_OF_STOCK';
  if (usable.lte(min)) return 'CRITICAL';
  if (usable.lte(reorder)) return 'REORDER';
  return 'OK';
}
