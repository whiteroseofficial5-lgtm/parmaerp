import { Prisma } from '@prisma/client';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { D, prisma, transaction, Tx } from '../lib/prisma';
import { nextNumber } from '../lib/sequence';
import { notifyRoles } from '../lib/notify';
import { sign } from '../lib/signature';
import { receiveLot } from './inventory.service';

// ───────────── Purchase orders ─────────────

export interface PoItemInput { rawMaterialId: string; quantity: number | string; unitPrice: number | string; taxPct?: number }

function totals(items: PoItemInput[]) {
  let subtotal = D(0), tax = D(0);
  for (const i of items) {
    const line = D(i.quantity).mul(D(i.unitPrice));
    subtotal = subtotal.add(line);
    tax = tax.add(line.mul(D(i.taxPct ?? 0)).div(100));
  }
  return { subtotal: subtotal.toDecimalPlaces(2), taxTotal: tax.toDecimalPlaces(2), total: subtotal.add(tax).toDecimalPlaces(2) };
}

export async function createPo(i: { supplierId: string; expectedDate?: Date; terms?: string; items: PoItemInput[]; requisitionId?: string }, userId: string) {
  if (!i.items.length) throw badRequest('A purchase order needs at least one line');
  return transaction(async (tx) => {
    const sup = await tx.supplier.findUnique({ where: { id: i.supplierId } });
    if (!sup || !sup.isActive) throw badRequest('Supplier not found or inactive');
    if (!sup.isApproved) throw badRequest(`Supplier ${sup.name} is not on the approved vendor list`);
    const po = await tx.purchaseOrder.create({
      data: {
        poNumber: await nextNumber(tx, 'PO'), supplierId: i.supplierId, expectedDate: i.expectedDate, terms: i.terms, createdById: userId, ...totals(i.items),
        items: { create: i.items.map((x) => ({ rawMaterialId: x.rawMaterialId, quantity: D(x.quantity), unitPrice: D(x.unitPrice), taxPct: D(x.taxPct ?? 0) })) },
      },
      include: { items: true },
    });
    if (i.requisitionId) await tx.purchaseRequisition.update({ where: { id: i.requisitionId }, data: { status: 'CONVERTED', poId: po.id } });
    await sign(tx, userId, 'PurchaseOrder', po.id, 'Prepared by');
    return po;
  });
}

export async function approvePo(id: string, userId: string, role: string) {
  return transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw notFound('PO not found');
    if (!['DRAFT', 'PENDING_APPROVAL'].includes(po.status)) throw conflict(`PO is ${po.status}`);
    if (po.createdById === userId && role !== 'SUPER_ADMIN') throw forbidden('Segregation of duties: the PO author cannot approve it');
    const u = await tx.purchaseOrder.update({ where: { id }, data: { status: 'APPROVED', approvedById: userId } });
    await sign(tx, userId, 'PurchaseOrder', id, 'Approved by');
    return u;
  });
}

// ───────────── GRN ─────────────

export interface GrnItemInput {
  poItemId?: string; rawMaterialId: string; lotNumber: string; supplierLot?: string; quantity: number | string; rejectedQty?: number | string;
  unitCost?: number | string; mfgDate?: Date; expiryDate?: Date; binId?: string; coaDocumentId?: string;
}

/** Post a GRN: creates QUARANTINE lots, updates PO received quantities and PO status. */
export async function postGrn(i: { poId?: string; supplierId?: string; warehouseId: string; challanNo?: string; vehicleNo?: string; notes?: string; items: GrnItemInput[] }, userId: string, txIn?: Tx) {
  const run = async (tx: Tx) => {
    const po = i.poId ? await tx.purchaseOrder.findUnique({ where: { id: i.poId }, include: { items: true } }) : null;
    if (i.poId && !po) throw notFound('PO not found');
    if (po && !['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status)) throw conflict(`PO ${po.poNumber} is ${po.status} and cannot be received against`);
    const supplierId = po?.supplierId ?? i.supplierId;
    if (!supplierId) throw badRequest('supplierId is required when no PO is given');

    const grn = await tx.grn.create({
      data: { grnNumber: await nextNumber(tx, 'GRN'), poId: po?.id, supplierId, warehouseId: i.warehouseId, status: 'POSTED', challanNo: i.challanNo, vehicleNo: i.vehicleNo, notes: i.notes, createdById: userId },
    });

    for (const it of i.items) {
      const poItem = po?.items.find((p) => p.id === it.poItemId || (!it.poItemId && p.rawMaterialId === it.rawMaterialId));
      const good = D(it.quantity).sub(D(it.rejectedQty ?? 0));
      if (poItem) {
        const cap = poItem.quantity.mul(1.1); // 10 % over-receipt tolerance
        if (poItem.receivedQty.add(good).gt(cap)) throw conflict(`Over-receipt for line ${it.rawMaterialId}: ordered ${poItem.quantity}, already received ${poItem.receivedQty}`);
      }
      const gi = await tx.grnItem.create({
        data: { grnId: grn.id, poItemId: poItem?.id, rawMaterialId: it.rawMaterialId, lotNumber: it.lotNumber, supplierLot: it.supplierLot, quantity: D(it.quantity), rejectedQty: D(it.rejectedQty ?? 0), unitCost: D(it.unitCost ?? poItem?.unitPrice ?? 0), mfgDate: it.mfgDate, expiryDate: it.expiryDate, binId: it.binId, coaDocumentId: it.coaDocumentId },
      });
      if (good.gt(0)) {
        await receiveLot(tx, {
          rawMaterialId: it.rawMaterialId, lotNumber: it.lotNumber, supplierLot: it.supplierLot, supplierId, warehouseId: i.warehouseId, binId: it.binId,
          quantity: good, unitCost: gi.unitCost, mfgDate: it.mfgDate, expiryDate: it.expiryDate, coaDocumentId: it.coaDocumentId, grnItemId: gi.id, reference: grn.grnNumber, userId,
        });
      }
      if (poItem) await tx.purchaseOrderItem.update({ where: { id: poItem.id }, data: { receivedQty: { increment: good } } });
    }

    if (po) {
      const items = await tx.purchaseOrderItem.findMany({ where: { poId: po.id } });
      const done = items.every((x) => x.receivedQty.gte(x.quantity));
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: done ? 'RECEIVED' : 'PARTIALLY_RECEIVED' } });
    }
    await sign(tx, userId, 'Grn', grn.id, 'Received by');
    return grn;
  };
  return txIn ? run(txIn) : transaction(run);
}

// ───────────── Invoice matching ─────────────

export interface InvoiceLine { rawMaterialId?: string | null; description: string; hsnCode?: string; quantity: number; unit?: string; unitPrice: number; taxPct?: number; amount: number }
export interface InvoiceData {
  invoiceNumber: string; invoiceDate: Date; supplierId: string; gstin?: string | null; poId?: string | null;
  subtotal: number; taxTotal: number; total: number; items: InvoiceLine[];
}
export interface Flag { severity: 'INFO' | 'WARNING' | 'CRITICAL'; code: string; message: string; line?: number }
export interface MatchResult {
  status: 'MATCHED' | 'MISMATCH';
  duplicate: boolean; duplicateOfId?: string;
  quantityMismatch: { line: number; description: string; invoiced: number; expected: number; basis: string }[];
  priceMismatch: { line: number; description: string; invoiced: number; expected: number; deviationPct: number; basis: string }[];
  flags: Flag[];
}

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PRICE_TOL = 0.02;       // 2 % vs PO price
const HISTORY_TOL = 0.2;      // 20 % vs last supplier price when there is no PO
const ARITH_TOL = 1;          // INR 1 rounding tolerance

/**
 * Deterministic three-way-ish match: Invoice ↔ PO ↔ GRN, plus duplicate & anomaly screening.
 * Kept rule-based on purpose — every flag is explainable to an auditor.
 */
export async function matchInvoice(d: InvoiceData): Promise<MatchResult> {
  const r: MatchResult = { status: 'MATCHED', duplicate: false, quantityMismatch: [], priceMismatch: [], flags: [] };
  const flag = (severity: Flag['severity'], code: string, message: string, line?: number) => r.flags.push({ severity, code, message, line });

  // 1. Duplicate detection
  const exact = await prisma.supplierInvoice.findFirst({ where: { supplierId: d.supplierId, invoiceNumber: d.invoiceNumber } });
  if (exact) { r.duplicate = true; r.duplicateOfId = exact.id; flag('CRITICAL', 'DUPLICATE_INVOICE', `Invoice ${d.invoiceNumber} already exists for this supplier.`); }
  const near = await prisma.supplierInvoice.findFirst({
    where: {
      supplierId: d.supplierId, invoiceNumber: { not: d.invoiceNumber }, total: D(d.total),
      invoiceDate: { gte: new Date(d.invoiceDate.getTime() - 3 * 86_400_000), lte: new Date(d.invoiceDate.getTime() + 3 * 86_400_000) },
    },
  });
  if (near) { r.duplicate = true; r.duplicateOfId ??= near.id; flag('WARNING', 'POSSIBLE_DUPLICATE', `Invoice ${near.invoiceNumber} has the same supplier, total and near-identical date — possible re-billing.`); }

  // 2. Supplier / GST checks
  const sup = await prisma.supplier.findUnique({ where: { id: d.supplierId } });
  if (sup && !sup.isApproved) flag('WARNING', 'UNAPPROVED_SUPPLIER', `${sup.name} is not on the approved vendor list.`);
  if (d.gstin) {
    if (!GSTIN_RE.test(d.gstin)) flag('CRITICAL', 'INVALID_GSTIN', `GSTIN ${d.gstin} has an invalid format.`);
    else if (sup?.gstin && sup.gstin !== d.gstin) flag('CRITICAL', 'GSTIN_MISMATCH', `Invoice GSTIN ${d.gstin} differs from supplier master (${sup.gstin}).`);
  } else flag('WARNING', 'MISSING_GSTIN', 'No supplier GSTIN found on the invoice.');

  // 3. Date sanity
  if (d.invoiceDate > new Date()) flag('CRITICAL', 'FUTURE_DATE', 'Invoice date is in the future.');

  // 4. Arithmetic integrity
  d.items.forEach((l, idx) => {
    const expected = l.quantity * l.unitPrice * (1 + (l.taxPct ?? 0) / 100);
    const base = l.quantity * l.unitPrice;
    if (Math.abs(l.amount - expected) > ARITH_TOL && Math.abs(l.amount - base) > ARITH_TOL)
      flag('WARNING', 'LINE_ARITHMETIC', `Line ${idx + 1}: ${l.quantity} × ${l.unitPrice} ≠ amount ${l.amount}.`, idx);
  });
  if (Math.abs(d.subtotal + d.taxTotal - d.total) > ARITH_TOL) flag('WARNING', 'TOTAL_ARITHMETIC', `Subtotal + tax (${(d.subtotal + d.taxTotal).toFixed(2)}) ≠ total (${d.total}).`);

  // 5. PO matching
  let po = d.poId ? await prisma.purchaseOrder.findUnique({ where: { id: d.poId }, include: { items: true, grns: { include: { items: true } } } }) : null;
  if (!po) {
    const ids = d.items.map((i) => i.rawMaterialId).filter(Boolean) as string[];
    if (ids.length) {
      po = await prisma.purchaseOrder.findFirst({
        where: { supplierId: d.supplierId, status: { in: ['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED'] }, items: { some: { rawMaterialId: { in: ids } } } },
        orderBy: { orderDate: 'desc' }, include: { items: true, grns: { include: { items: true } } },
      });
      if (po) flag('INFO', 'PO_AUTO_LINKED', `Auto-linked to ${po.poNumber} (latest open PO for this supplier & materials).`);
    }
  }
  if (!po) {
    flag('WARNING', 'NO_PO', 'No matching purchase order found — purchase made without PO?');
    for (const [idx, l] of d.items.entries()) {
      if (!l.rawMaterialId) continue;
      const last = await prisma.supplierPrice.findFirst({ where: { supplierId: d.supplierId, rawMaterialId: l.rawMaterialId }, orderBy: { effectiveDate: 'desc' } });
      if (last && Number(last.price) > 0) {
        const dev = (l.unitPrice - Number(last.price)) / Number(last.price);
        if (Math.abs(dev) > HISTORY_TOL) r.priceMismatch.push({ line: idx, description: l.description, invoiced: l.unitPrice, expected: Number(last.price), deviationPct: +(dev * 100).toFixed(1), basis: 'last supplier price' });
      }
    }
  } else {
    if (po.orderDate > d.invoiceDate) flag('WARNING', 'INVOICE_BEFORE_PO', 'Invoice is dated before the purchase order.');
    const received = new Map<string, number>();
    po.grns.forEach((g) => g.items.forEach((gi) => received.set(gi.rawMaterialId, (received.get(gi.rawMaterialId) ?? 0) + Number(gi.quantity))));
    d.items.forEach((l, idx) => {
      if (!l.rawMaterialId) return flag('WARNING', 'UNMAPPED_ITEM', `Line ${idx + 1} "${l.description}" could not be mapped to a raw material.`, idx);
      const pi = po!.items.find((p) => p.rawMaterialId === l.rawMaterialId);
      if (!pi) return flag('CRITICAL', 'NOT_ON_PO', `Line ${idx + 1} "${l.description}" is not on ${po!.poNumber}.`, idx);
      if (l.quantity > Number(pi.quantity) * 1.001) r.quantityMismatch.push({ line: idx, description: l.description, invoiced: l.quantity, expected: Number(pi.quantity), basis: `ordered on ${po!.poNumber}` });
      const got = received.get(l.rawMaterialId);
      if (got !== undefined && l.quantity > got * 1.001) r.quantityMismatch.push({ line: idx, description: l.description, invoiced: l.quantity, expected: got, basis: 'received per GRN' });
      const dev = (l.unitPrice - Number(pi.unitPrice)) / Number(pi.unitPrice);
      if (Math.abs(dev) > PRICE_TOL) r.priceMismatch.push({ line: idx, description: l.description, invoiced: l.unitPrice, expected: Number(pi.unitPrice), deviationPct: +(dev * 100).toFixed(1), basis: `PO ${po!.poNumber}` });
    });
  }
  if (r.quantityMismatch.length) flag('CRITICAL', 'QTY_MISMATCH', `${r.quantityMismatch.length} line(s) invoiced above ordered/received quantity.`);
  if (r.priceMismatch.length) flag('WARNING', 'PRICE_MISMATCH', `${r.priceMismatch.length} line(s) with unit-price deviation.`);

  if (r.flags.some((f) => f.severity !== 'INFO')) r.status = 'MISMATCH';
  return r;
}

/** Persist an invoice + its match result; optionally receive stock through a GRN. */
export async function saveInvoice(d: InvoiceData, opts: { documentId?: string; source: 'MANUAL' | 'AI_IMPORT'; userId: string; autoReceive?: { warehouseId: string } }) {
  const match = await matchInvoice(d);
  if (match.flags.some((f) => f.code === 'DUPLICATE_INVOICE')) throw conflict('Duplicate invoice — not saved', match);

  return transaction(async (tx) => {
    const inv = await tx.supplierInvoice.create({
      data: {
        invoiceNumber: d.invoiceNumber, invoiceDate: d.invoiceDate, supplierId: d.supplierId, gstin: d.gstin ?? undefined, poId: d.poId ?? undefined,
        subtotal: D(d.subtotal), taxTotal: D(d.taxTotal), total: D(d.total), documentId: opts.documentId, source: opts.source, createdById: opts.userId,
        status: match.status === 'MATCHED' ? 'MATCHED' : 'MISMATCH', matchResult: match as unknown as Prisma.InputJsonValue,
        items: { create: d.items.map((l) => ({ rawMaterialId: l.rawMaterialId ?? undefined, description: l.description, hsnCode: l.hsnCode, quantity: D(l.quantity), unit: l.unit, unitPrice: D(l.unitPrice), taxPct: D(l.taxPct ?? 0), amount: D(l.amount) })) },
      },
      include: { items: true },
    });
    if (match.status === 'MISMATCH') {
      await notifyRoles(['PURCHASE_MANAGER'], { type: 'INVOICE_MISMATCH', severity: 'CRITICAL', title: 'Invoice needs review', message: `Invoice ${d.invoiceNumber}: ${match.flags.filter((f) => f.severity !== 'INFO').map((f) => f.code).join(', ')}`, link: `/purchase/invoices`, dedupeKey: `INV:${inv.id}` });
    } else if (opts.autoReceive) {
      await receiveInvoiceStock(tx, inv.id, opts.autoReceive.warehouseId, opts.userId);
    }
    return { invoice: inv, match };
  });
}

/** Turn invoice lines into a posted GRN (stock enters QUARANTINE). Requires every line to be mapped. */
export async function receiveInvoiceStock(tx: Tx, invoiceId: string, warehouseId: string, userId: string) {
  const inv = await tx.supplierInvoice.findUnique({ where: { id: invoiceId }, include: { items: true } });
  if (!inv) throw notFound('Invoice not found');
  if (inv.grnId) throw conflict('Stock has already been received for this invoice');
  const unmapped = inv.items.filter((i) => !i.rawMaterialId);
  if (unmapped.length) throw badRequest(`${unmapped.length} invoice line(s) are not mapped to raw materials`);
  const grn = await postGrn(
    {
      poId: inv.poId && (await tx.purchaseOrder.findUnique({ where: { id: inv.poId } }))?.status !== 'CLOSED' ? inv.poId : undefined,
      supplierId: inv.supplierId, warehouseId, notes: `Auto-received from invoice ${inv.invoiceNumber}`,
      items: inv.items.map((i, n) => ({ rawMaterialId: i.rawMaterialId!, lotNumber: `INV${inv.invoiceNumber.replace(/[^A-Za-z0-9]/g, '')}-${n + 1}`, quantity: i.quantity.toString(), unitCost: i.unitPrice.toString() })),
    },
    userId, tx,
  ).catch(async (e) => {
    // A PO-linked receipt can fail tolerance/status rules; retry as an unlinked receipt so stock is never lost.
    if (!inv.poId) throw e;
    return postGrn({ supplierId: inv.supplierId, warehouseId, notes: `Auto-received from invoice ${inv.invoiceNumber} (PO link skipped: ${e.message})`, items: inv.items.map((i, n) => ({ rawMaterialId: i.rawMaterialId!, lotNumber: `INV${inv.invoiceNumber.replace(/[^A-Za-z0-9]/g, '')}-${n + 1}`, quantity: i.quantity.toString(), unitCost: i.unitPrice.toString() })) }, userId, tx);
  });
  await tx.supplierInvoice.update({ where: { id: invoiceId }, data: { grnId: grn.id, status: 'APPROVED' } });
  return grn;
}

export async function approveInvoice(id: string, userId: string, warehouseId?: string) {
  return transaction(async (tx) => {
    const inv = await tx.supplierInvoice.findUnique({ where: { id } });
    if (!inv) throw notFound('Invoice not found');
    if (['REJECTED', 'PAID'].includes(inv.status)) throw conflict(`Invoice is ${inv.status}`);
    await sign(tx, userId, 'SupplierInvoice', id, 'Approved by');
    if (warehouseId && !inv.grnId) { await receiveInvoiceStock(tx, id, warehouseId, userId); return tx.supplierInvoice.findUniqueOrThrow({ where: { id } }); }
    return tx.supplierInvoice.update({ where: { id }, data: { status: 'APPROVED' } });
  });
}
