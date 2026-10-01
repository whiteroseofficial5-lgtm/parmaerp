import { Prisma, Role } from '@prisma/client';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { D, prisma, transaction, Tx } from '../lib/prisma';
import { convertQty } from '../lib/uom';
import { notifyRoles } from '../lib/notify';
import { sign } from '../lib/signature';

export interface FormulaItemInput {
  rawMaterialId: string;
  quantity: number | string;
  unit: string;
  wastagePct?: number;
  stage?: string;
}
export interface FormulaInput {
  productId: string;
  baseBatchSize: number | string;
  baseBatchUnit?: string;
  expectedYieldPct?: number;
  instructions?: string;
  changeReason?: string;
  items: FormulaItemInput[];
}

const includeAll = { product: true, items: { include: { rawMaterial: true }, orderBy: { sequence: 'asc' as const } } };

function validateItems(items: FormulaItemInput[]) {
  if (!items.length) throw badRequest('A formula needs at least one ingredient');
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.rawMaterialId)) throw badRequest('Duplicate ingredient in formula');
    seen.add(it.rawMaterialId);
    if (D(it.quantity).lte(0)) throw badRequest('Ingredient quantity must be greater than zero');
  }
}

export async function createFormula(input: FormulaInput, userId: string) {
  validateItems(input.items);
  return transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: input.productId } });
    if (!product) throw notFound('Product not found');
    const last = await tx.formula.findFirst({ where: { productId: input.productId }, orderBy: { version: 'desc' } });
    const f = await tx.formula.create({
      data: {
        productId: input.productId,
        version: (last?.version ?? 0) + 1,
        baseBatchSize: D(input.baseBatchSize),
        baseBatchUnit: input.baseBatchUnit ?? product.uom,
        expectedYieldPct: D(input.expectedYieldPct ?? 98),
        instructions: input.instructions,
        changeReason: input.changeReason ?? (last ? undefined : 'Initial version'),
        createdById: userId,
        items: {
          create: input.items.map((it, idx) => ({
            rawMaterialId: it.rawMaterialId, quantity: D(it.quantity), unit: it.unit, wastagePct: D(it.wastagePct ?? 0), sequence: idx, stage: it.stage,
          })),
        },
      },
      include: includeAll,
    });
    await tx.formulaHistory.create({ data: { formulaId: f.id, action: 'CREATED', userId, remarks: input.changeReason, snapshot: snapshot(f) } });
    return f;
  });
}

export async function updateFormula(id: string, input: Partial<FormulaInput>, userId: string) {
  return transaction(async (tx) => {
    const f = await tx.formula.findUnique({ where: { id } });
    if (!f) throw notFound('Formula not found');
    if (!['DRAFT', 'REJECTED'].includes(f.status)) throw conflict('Only DRAFT or REJECTED formulas can be edited — create a new version instead');
    if (input.items) {
      validateItems(input.items);
      await tx.formulaItem.deleteMany({ where: { formulaId: id } });
      await tx.formulaItem.createMany({
        data: input.items.map((it, idx) => ({
          formulaId: id, rawMaterialId: it.rawMaterialId, quantity: D(it.quantity), unit: it.unit, wastagePct: D(it.wastagePct ?? 0), sequence: idx, stage: it.stage,
        })),
      });
    }
    const updated = await tx.formula.update({
      where: { id },
      data: {
        baseBatchSize: input.baseBatchSize !== undefined ? D(input.baseBatchSize) : undefined,
        baseBatchUnit: input.baseBatchUnit,
        expectedYieldPct: input.expectedYieldPct !== undefined ? D(input.expectedYieldPct) : undefined,
        instructions: input.instructions,
        changeReason: input.changeReason,
        status: 'DRAFT',
      },
      include: includeAll,
    });
    await tx.formulaHistory.create({ data: { formulaId: id, action: 'EDITED', userId, snapshot: snapshot(updated) } });
    return updated;
  });
}

/** Copy an existing version into a new DRAFT (the only way to change an approved formula). */
export async function newVersionFrom(id: string, userId: string, changeReason: string) {
  const src = await prisma.formula.findUnique({ where: { id }, include: { items: true } });
  if (!src) throw notFound('Formula not found');
  return createFormula(
    {
      productId: src.productId, baseBatchSize: src.baseBatchSize.toString(), baseBatchUnit: src.baseBatchUnit,
      expectedYieldPct: Number(src.expectedYieldPct), instructions: src.instructions ?? undefined, changeReason,
      items: src.items.map((i) => ({ rawMaterialId: i.rawMaterialId, quantity: i.quantity.toString(), unit: i.unit, wastagePct: Number(i.wastagePct), stage: i.stage ?? undefined })),
    },
    userId,
  );
}

export async function submitFormula(id: string, userId: string) {
  return transaction(async (tx) => {
    const f = await tx.formula.findUnique({ where: { id }, include: { product: true } });
    if (!f) throw notFound('Formula not found');
    if (!['DRAFT', 'REJECTED'].includes(f.status)) throw conflict(`Formula is ${f.status}; only DRAFT/REJECTED can be submitted`);
    const u = await tx.formula.update({ where: { id }, data: { status: 'PENDING_APPROVAL' } });
    await tx.formulaHistory.create({ data: { formulaId: id, action: 'SUBMITTED', userId } });
    await sign(tx, userId, 'Formula', id, 'Prepared by');
    await notifyRoles(['QC_MANAGER'], {
      type: 'FORMULA_APPROVAL_PENDING', severity: 'WARNING', title: 'Formula awaiting approval',
      message: `${f.product.name} formula v${f.version} was submitted for approval.`, link: `/formulas/${id}`, dedupeKey: `FAP:${id}:${Date.now()}`,
    });
    return u;
  });
}

export async function approveFormula(id: string, userId: string, role: Role, remarks?: string) {
  return transaction(async (tx) => {
    const f = await tx.formula.findUnique({ where: { id } });
    if (!f) throw notFound('Formula not found');
    if (f.status !== 'PENDING_APPROVAL') throw conflict('Formula is not pending approval');
    if (f.createdById === userId && role !== 'SUPER_ADMIN') throw forbidden('Segregation of duties: the author cannot approve their own formula');

    const cost = await computeFormulaCost(tx, id);
    await tx.formula.updateMany({ where: { productId: f.productId, status: 'APPROVED' }, data: { status: 'OBSOLETE' } });
    const u = await tx.formula.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date(), effectiveFrom: new Date(), standardCost: cost.materialCost },
    });
    await tx.formulaHistory.create({ data: { formulaId: id, action: 'APPROVED', userId, remarks } });
    await sign(tx, userId, 'Formula', id, 'Approved by');
    return u;
  });
}

export async function rejectFormula(id: string, userId: string, remarks: string) {
  if (!remarks?.trim()) throw badRequest('A rejection reason is required');
  return transaction(async (tx) => {
    const f = await tx.formula.findUnique({ where: { id } });
    if (!f || f.status !== 'PENDING_APPROVAL') throw conflict('Formula is not pending approval');
    const u = await tx.formula.update({ where: { id }, data: { status: 'REJECTED' } });
    await tx.formulaHistory.create({ data: { formulaId: id, action: 'REJECTED', userId, remarks } });
    return u;
  });
}

const snapshot = (f: any) => JSON.parse(JSON.stringify(f, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

// ───────────── Costing & BOM explosion ─────────────

export interface BomLine {
  rawMaterialId: string; code: string; name: string; category: string;
  formulaUnit: string; stockUom: string; stage?: string | null;
  baseQty: string; wastagePct: string;
  requiredQty: string;       // in formula unit, scaled & incl. wastage
  requiredInStockUom: string; // converted to the material's stock UOM
  unitCost: string;          // per stock UOM
  lineCost: string;
  availableStock: string;    // usable (APPROVED, non-expired), stock UOM
  shortage: string;
}

/** Weighted-average cost of usable lots; falls back to last purchase price if nothing is on hand. */
async function materialUnitCost(tx: Tx, rawMaterialId: string, fallback: Prisma.Decimal) {
  const lots = await tx.materialLot.findMany({
    where: { rawMaterialId, status: 'APPROVED', availableQty: { gt: 0 } },
    select: { availableQty: true, unitCost: true },
  });
  const qty = lots.reduce((s, l) => s.add(l.availableQty), D(0));
  if (qty.isZero()) return { unitCost: fallback, available: D(0) };
  const value = lots.reduce((s, l) => s.add(l.availableQty.mul(l.unitCost)), D(0));
  return { unitCost: value.div(qty), available: qty };
}

export async function computeFormulaCost(tx: Tx | typeof prisma, formulaId: string, batchSize?: number | string) {
  const f = await (tx as Tx).formula.findUnique({ where: { id: formulaId }, include: includeAll });
  if (!f) throw notFound('Formula not found');
  const size = batchSize !== undefined ? D(batchSize) : f.baseBatchSize;
  if (size.lte(0)) throw badRequest('Batch size must be greater than zero');
  const scale = size.div(f.baseBatchSize);

  const lines: BomLine[] = [];
  let total = D(0);
  for (const it of f.items) {
    const required = it.quantity.mul(scale).mul(D(1).add(it.wastagePct.div(100)));
    const reqStock = convertQty(required, it.unit, it.rawMaterial.uom);
    const { unitCost, available } = await materialUnitCost(tx as Tx, it.rawMaterialId, it.rawMaterial.purchasePrice);
    const lineCost = reqStock.mul(unitCost);
    total = total.add(lineCost);
    lines.push({
      rawMaterialId: it.rawMaterialId, code: it.rawMaterial.code, name: it.rawMaterial.name, category: it.rawMaterial.category,
      formulaUnit: it.unit, stockUom: it.rawMaterial.uom, stage: it.stage,
      baseQty: it.quantity.toString(), wastagePct: it.wastagePct.toString(),
      requiredQty: required.toDecimalPlaces(4).toString(), requiredInStockUom: reqStock.toDecimalPlaces(4).toString(),
      unitCost: unitCost.toDecimalPlaces(4).toString(), lineCost: lineCost.toDecimalPlaces(2).toString(),
      availableStock: available.toDecimalPlaces(3).toString(),
      shortage: Prisma.Decimal.max(reqStock.sub(available), D(0)).toDecimalPlaces(3).toString(),
    });
  }
  const expectedOutput = size.mul(f.expectedYieldPct).div(100);
  return {
    formulaId: f.id, productId: f.productId, productName: f.product.name, productCode: f.product.code, version: f.version,
    batchSize: size.toString(), batchUnit: f.baseBatchUnit,
    expectedYieldPct: f.expectedYieldPct.toString(), expectedOutput: expectedOutput.toString(),
    expectedWastagePct: D(100).sub(f.expectedYieldPct).toString(),
    materialCost: total.toDecimalPlaces(2),
    costPerUnit: expectedOutput.gt(0) ? total.div(expectedOutput).toDecimalPlaces(4).toString() : '0',
    instructions: f.instructions,
    lines,
    canManufacture: lines.every((l) => D(l.shortage).isZero()),
  };
}

/** BOM = the currently effective (APPROVED) formula exploded for a batch size. */
export async function getBom(productId: string, batchSize?: number | string) {
  const f = await prisma.formula.findFirst({ where: { productId, status: 'APPROVED' }, orderBy: { version: 'desc' } });
  if (!f) throw notFound('No approved formula for this product');
  return computeFormulaCost(prisma as unknown as Tx, f.id, batchSize);
}

export const effectiveFormula = (productId: string) =>
  prisma.formula.findFirst({ where: { productId, status: 'APPROVED' }, orderBy: { version: 'desc' }, include: { items: { include: { rawMaterial: true } }, product: true } });

/** Field-level diff between two versions of a formula — for change control review. */
export async function diffVersions(aId: string, bId: string) {
  const [a, b] = await Promise.all([
    prisma.formula.findUnique({ where: { id: aId }, include: { items: { include: { rawMaterial: true } } } }),
    prisma.formula.findUnique({ where: { id: bId }, include: { items: { include: { rawMaterial: true } } } }),
  ]);
  if (!a || !b) throw notFound('Formula not found');
  const am = new Map(a.items.map((i) => [i.rawMaterialId, i]));
  const bm = new Map(b.items.map((i) => [i.rawMaterialId, i]));
  const changes: any[] = [];
  for (const [id, bi] of bm) {
    const ai = am.get(id);
    if (!ai) changes.push({ type: 'ADDED', material: bi.rawMaterial.name, to: `${bi.quantity} ${bi.unit}` });
    else if (!ai.quantity.eq(bi.quantity) || ai.unit !== bi.unit || !ai.wastagePct.eq(bi.wastagePct))
      changes.push({ type: 'CHANGED', material: bi.rawMaterial.name, from: `${ai.quantity} ${ai.unit} (+${ai.wastagePct}%)`, to: `${bi.quantity} ${bi.unit} (+${bi.wastagePct}%)` });
  }
  for (const [id, ai] of am) if (!bm.has(id)) changes.push({ type: 'REMOVED', material: ai.rawMaterial.name, from: `${ai.quantity} ${ai.unit}` });
  return { from: a.version, to: b.version, changes };
}
