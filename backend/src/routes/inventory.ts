import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler';
import { badRequest, conflict, notFound } from '../lib/errors';
import { pageParams, paged } from '../lib/pagination';
import { D, prisma, transaction } from '../lib/prisma';
import { nextNumber } from '../lib/sequence';
import { requirePermission } from '../middleware/auth';
import { adjustLot, receiveLot, stockOut, transferLot } from '../services/inventory.service';
import { batchesUsingLot } from '../services/batch.service';
import { sign } from '../lib/signature';

export const inventoryRouter = Router();
const num = z.coerce.number();
const date = z.coerce.date();

inventoryRouter.get('/lots', requirePermission('stock:read'), ah(async (req, res) => {
  const { skip, take, page, pageSize, q } = pageParams(req);
  const { materialId, status, warehouseId, expiringInDays } = req.query as Record<string, string | undefined>;
  const where: any = {
    ...(materialId && { rawMaterialId: materialId }), ...(status && { status }), ...(warehouseId && { warehouseId }),
    ...(expiringInDays && { expiryDate: { lte: new Date(Date.now() + Number(expiringInDays) * 86_400_000) }, availableQty: { gt: 0 } }),
    ...(q && { OR: [{ lotNumber: { contains: q, mode: 'insensitive' } }, { rawMaterial: { name: { contains: q, mode: 'insensitive' } } }, { rawMaterial: { code: { contains: q, mode: 'insensitive' } } }] }),
  };
  const [rows, total] = await Promise.all([
    prisma.materialLot.findMany({ where, skip, take, orderBy: { expiryDate: 'asc' }, include: { rawMaterial: { select: { code: true, name: true, uom: true } }, warehouse: { select: { name: true } }, bin: { select: { code: true } }, supplier: { select: { name: true } } } }),
    prisma.materialLot.count({ where }),
  ]);
  res.json(paged(rows, total, page, pageSize));
}));

// Stock In (direct receipt: opening balance, returns, samples; supplier receipts should go via GRN)
inventoryRouter.post('/receive', requirePermission('stock:create'), ah(async (req, res) => {
  const b = z.object({ rawMaterialId: z.string(), lotNumber: z.string().min(1), supplierLot: z.string().optional(), supplierId: z.string().optional(), warehouseId: z.string(), binId: z.string().optional(), quantity: num.positive(), unitCost: num.min(0), mfgDate: date.optional(), expiryDate: date.optional(), coaDocumentId: z.string().optional(), status: z.enum(['QUARANTINE', 'APPROVED']).default('QUARANTINE'), reason: z.string().min(3) }).parse(req.body);
  if (b.status === 'APPROVED' && !['SUPER_ADMIN', 'QC_MANAGER'].includes(req.user!.role)) throw badRequest('Only QC/Admin may receive stock directly as APPROVED (opening balances)');
  const lot = await transaction(async (tx) => receiveLot(tx, { ...b, reference: `MANUAL-${b.reason}`.slice(0, 60), userId: req.user!.id }));
  res.status(201).json(lot);
}));

// Stock Out
inventoryRouter.post('/issue', requirePermission('stock:create'), ah(async (req, res) => {
  const b = z.object({ rawMaterialId: z.string(), quantity: num.positive(), lotId: z.string().optional(), reason: z.string().min(3), type: z.enum(['ISSUE', 'RETURN', 'WRITE_OFF']).default('ISSUE') }).parse(req.body);
  res.json(await transaction((tx) => stockOut(tx, { ...b, type: b.type === 'RETURN' ? 'RETURN' : b.type, userId: req.user!.id })));
}));

// Transfer & adjustment
inventoryRouter.post('/transfer', requirePermission('stock:transfer'), ah(async (req, res) => {
  const b = z.object({ materialLotId: z.string(), toWarehouseId: z.string(), toBinId: z.string().optional(), quantity: num.positive().optional() }).parse(req.body);
  res.json(await transaction((tx) => transferLot(tx, { ...b, userId: req.user!.id })));
}));
inventoryRouter.post('/adjust', requirePermission('stock:adjust'), ah(async (req, res) => {
  const b = z.object({ materialLotId: z.string(), newQuantity: num.min(0), reason: z.string().min(5) }).parse(req.body);
  res.json(await transaction((tx) => adjustLot(tx, { ...b, userId: req.user!.id })));
}));

// Manual lot disposition (QC/Admin): e.g. release opening stock or block a suspect lot
inventoryRouter.post('/lots/:id/status', requirePermission('stock:approve-lot'), ah(async (req, res) => {
  const b = z.object({ status: z.enum(['APPROVED', 'REJECTED', 'QUARANTINE']), reason: z.string().min(5) }).parse(req.body);
  res.json(await transaction(async (tx) => { const l = await tx.materialLot.update({ where: { id: req.params.id }, data: { status: b.status } }); await sign(tx, req.user!.id, 'MaterialLot', l.id, `Status → ${b.status}: ${b.reason}`); return l; }));
}));

inventoryRouter.get('/lots/:id/ledger', requirePermission('stock:read'), ah(async (req, res) => res.json(await prisma.stockMovement.findMany({ where: { materialLotId: req.params.id }, orderBy: { createdAt: 'asc' } }))));
inventoryRouter.get('/lots/:id/where-used', requirePermission('batch:read'), ah(async (req, res) => res.json(await batchesUsingLot(req.params.id))));

inventoryRouter.get('/ledger', requirePermission('stock:read'), ah(async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req, 50);
  const { materialId, type, from, to } = req.query as Record<string, string | undefined>;
  const where: any = { ...(type && { type }), ...(materialId && { materialLot: { rawMaterialId: materialId } }), ...((from || to) && { createdAt: { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } }) };
  const [rows, total] = await Promise.all([
    prisma.stockMovement.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: { materialLot: { select: { lotNumber: true, rawMaterial: { select: { code: true, name: true, uom: true } } } }, fgLot: { select: { batch: { select: { batchNumber: true } }, product: { select: { name: true } } } } } }),
    prisma.stockMovement.count({ where }),
  ]);
  res.json(paged(rows, total, page, pageSize));
}));

// ───────── Transfer orders (document-based, multi-line) ─────────
inventoryRouter.get('/transfer-orders', requirePermission('warehouse:read'), ah(async (_req, res) => res.json(await prisma.transferOrder.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { from: { select: { name: true } }, to: { select: { name: true } }, items: true } }))));
inventoryRouter.post('/transfer-orders', requirePermission('warehouse:create'), ah(async (req, res) => {
  const b = z.object({ fromWarehouseId: z.string(), toWarehouseId: z.string(), notes: z.string().optional(), items: z.array(z.object({ materialLotId: z.string(), quantity: num.positive(), toBinId: z.string().optional() })).min(1) }).parse(req.body);
  if (b.fromWarehouseId === b.toWarehouseId) throw badRequest('Source and destination warehouses must differ');
  res.status(201).json(await transaction(async (tx) => tx.transferOrder.create({ data: { trfNumber: await nextNumber(tx, 'TO'), fromWarehouseId: b.fromWarehouseId, toWarehouseId: b.toWarehouseId, notes: b.notes, createdById: req.user!.id, items: { create: b.items } }, include: { items: true } })));
}));
inventoryRouter.post('/transfer-orders/:id/execute', requirePermission('stock:transfer'), ah(async (req, res) => {
  res.json(await transaction(async (tx) => {
    const t = await tx.transferOrder.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!t) throw notFound();
    if (t.status !== 'DRAFT' && t.status !== 'IN_TRANSIT') throw conflict(`Transfer order is ${t.status}`);
    for (const it of t.items) {
      const lot = await tx.materialLot.findUnique({ where: { id: it.materialLotId } });
      if (lot?.warehouseId !== t.fromWarehouseId) throw conflict(`Lot ${lot?.lotNumber} is not in the source warehouse`);
      await transferLot(tx, { materialLotId: it.materialLotId, toWarehouseId: t.toWarehouseId, toBinId: it.toBinId ?? undefined, quantity: it.quantity.toString(), reference: t.trfNumber, userId: req.user!.id });
    }
    return tx.transferOrder.update({ where: { id: t.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
  }));
}));

// ───────── Inventory reconciliation (cycle count) ─────────
inventoryRouter.get('/counts', requirePermission('warehouse:read'), ah(async (_req, res) => res.json(await prisma.stockCount.findMany({ orderBy: { createdAt: 'desc' }, take: 50, include: { warehouse: { select: { name: true } }, _count: { select: { items: true } } } }))));
inventoryRouter.get('/counts/:id', requirePermission('warehouse:read'), ah(async (req, res) => res.json(await prisma.stockCount.findUnique({ where: { id: req.params.id }, include: { warehouse: true, items: { include: { rawMaterial: { select: { code: true, name: true, uom: true } } } } } }))));
inventoryRouter.post('/counts', requirePermission('warehouse:create'), ah(async (req, res) => {
  const { warehouseId } = z.object({ warehouseId: z.string() }).parse(req.body);
  res.status(201).json(await transaction(async (tx) => {
    const lots = await tx.materialLot.findMany({ where: { warehouseId, availableQty: { gt: 0 } } });
    return tx.stockCount.create({ data: { countNumber: await nextNumber(tx, 'CNT'), warehouseId, createdById: req.user!.id, items: { create: lots.map((l) => ({ materialLotId: l.id, rawMaterialId: l.rawMaterialId, systemQty: l.availableQty })) } }, include: { items: true } });
  }));
}));
inventoryRouter.patch('/counts/:id/items', requirePermission('warehouse:update'), ah(async (req, res) => {
  const items = z.array(z.object({ id: z.string(), countedQty: num.min(0) })).parse(req.body.items);
  await transaction(async (tx) => { for (const i of items) await tx.stockCountItem.update({ where: { id: i.id }, data: { countedQty: i.countedQty } }); });
  res.json({ updated: items.length });
}));
inventoryRouter.post('/counts/:id/reconcile', requirePermission('stock:adjust'), ah(async (req, res) => {
  res.json(await transaction(async (tx) => {
    const c = await tx.stockCount.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!c || c.status !== 'OPEN') throw conflict('Count is not open');
    if (c.items.some((i) => i.countedQty === null)) throw badRequest('All lines must be counted before reconciliation');
    let adjusted = 0;
    for (const i of c.items) {
      if (!i.countedQty!.eq(i.systemQty)) { await adjustLot(tx, { materialLotId: i.materialLotId, newQuantity: i.countedQty!.toString(), reason: `Cycle count ${c.countNumber} variance`, userId: req.user!.id, reference: c.countNumber }); adjusted++; }
    }
    await tx.stockCount.update({ where: { id: c.id }, data: { status: 'RECONCILED', reconciledAt: new Date() } });
    return { adjustedLots: adjusted };
  }));
}));

// ───────── Finished goods ─────────
export const fgRouter = Router();
fgRouter.get('/', requirePermission('fg:read'), ah(async (req, res) => {
  const { skip, take, page, pageSize, q } = pageParams(req);
  const { status, productId, warehouseId } = req.query as Record<string, string | undefined>;
  const where: any = { ...(status && { status }), ...(productId && { productId }), ...(warehouseId && { warehouseId }), ...(q && { OR: [{ product: { name: { contains: q, mode: 'insensitive' } } }, { batch: { batchNumber: { contains: q, mode: 'insensitive' } } }] }) };
  const [rows, total] = await Promise.all([
    prisma.finishedGoodLot.findMany({ where, skip, take, orderBy: { expiryDate: 'asc' }, include: { product: { select: { name: true, code: true, strength: true } }, batch: { select: { batchNumber: true } }, warehouse: { select: { name: true } }, bin: { select: { code: true } } } }),
    prisma.finishedGoodLot.count({ where }),
  ]);
  res.json(paged(rows, total, page, pageSize));
}));
fgRouter.get('/:id/ledger', requirePermission('fg:read'), ah(async (req, res) => res.json(await prisma.stockMovement.findMany({ where: { fgLotId: req.params.id }, orderBy: { createdAt: 'asc' } }))));
fgRouter.post('/:id/reserve', requirePermission('fg:update'), ah(async (req, res) => {
  const { quantity } = z.object({ quantity: num }).parse(req.body); // positive = reserve, negative = release reservation
  res.json(await transaction(async (tx) => {
    const l = await tx.finishedGoodLot.findUnique({ where: { id: req.params.id } });
    if (!l || l.status !== 'RELEASED') throw conflict('Only RELEASED lots can be reserved');
    const next = l.reservedQty.add(D(quantity));
    if (next.lt(0) || next.gt(l.availableQty)) throw badRequest('Reservation must stay between 0 and available quantity');
    return tx.finishedGoodLot.update({ where: { id: l.id }, data: { reservedQty: next } });
  }));
}));
fgRouter.post('/:id/move', requirePermission('fg:update'), ah(async (req, res) => {
  const { warehouseId, binId } = z.object({ warehouseId: z.string(), binId: z.string().optional() }).parse(req.body);
  res.json(await transaction(async (tx) => {
    const l = await tx.finishedGoodLot.findUniqueOrThrow({ where: { id: req.params.id } });
    await tx.stockMovement.create({ data: { type: 'TRANSFER_OUT', fgLotId: l.id, quantity: 0, balanceAfter: l.availableQty, fromWarehouseId: l.warehouseId, toWarehouseId: warehouseId, reference: `MOVE-${l.id.slice(-6)}`, reason: 'Location change', userId: req.user!.id } });
    return tx.finishedGoodLot.update({ where: { id: l.id }, data: { warehouseId, binId: binId ?? null } });
  }));
}));

fgRouter.get('/dispatches/all', requirePermission('fg:read'), ah(async (_req, res) => res.json(await prisma.dispatch.findMany({ orderBy: { dispatchedAt: 'desc' }, take: 100, include: { items: { include: { fgLot: { include: { batch: { select: { batchNumber: true } }, product: { select: { name: true } } } } } } } }))));
fgRouter.post('/dispatch', requirePermission('stock:dispatch'), ah(async (req, res) => {
  const b = z.object({ customer: z.string().min(2), destination: z.string().optional(), vehicleNo: z.string().optional(), invoiceRef: z.string().optional(), items: z.array(z.object({ fgLotId: z.string(), quantity: num.positive() })).min(1) }).parse(req.body);
  res.status(201).json(await transaction(async (tx) => {
    const number = await nextNumber(tx, 'DSP');
    const d = await tx.dispatch.create({ data: { dispatchNumber: number, customer: b.customer, destination: b.destination, vehicleNo: b.vehicleNo, invoiceRef: b.invoiceRef, createdById: req.user!.id } });
    for (const it of b.items) {
      const lot = await tx.finishedGoodLot.findUnique({ where: { id: it.fgLotId }, include: { batch: true } });
      if (!lot) throw notFound('Finished-goods lot not found');
      if (lot.status !== 'RELEASED') throw conflict(`Batch ${lot.batch.batchNumber} is ${lot.status} — only QC-RELEASED stock can be dispatched`);
      if (lot.expiryDate < new Date()) throw conflict(`Batch ${lot.batch.batchNumber} is expired`);
      // Reserved stock is dispatchable (it was reserved for orders); the guard is against physical availability.
      const r = await tx.finishedGoodLot.updateMany({ where: { id: lot.id, availableQty: { gte: D(it.quantity) } }, data: { availableQty: { decrement: D(it.quantity) }, reservedQty: lot.reservedQty.gt(D(it.quantity)) ? { decrement: D(it.quantity) } : 0 } });
      if (r.count === 0) throw conflict(`Insufficient quantity in batch ${lot.batch.batchNumber}`);
      const after = await tx.finishedGoodLot.findUniqueOrThrow({ where: { id: lot.id } });
      if (after.availableQty.lte(0)) await tx.finishedGoodLot.update({ where: { id: lot.id }, data: { status: 'DEPLETED' } });
      await tx.dispatchItem.create({ data: { dispatchId: d.id, fgLotId: lot.id, quantity: D(it.quantity) } });
      await tx.stockMovement.create({ data: { type: 'DISPATCH', fgLotId: lot.id, quantity: D(it.quantity).neg(), balanceAfter: after.availableQty, reference: number, reason: `To ${b.customer}`, userId: req.user!.id } });
    }
    return d;
  }));
}));
