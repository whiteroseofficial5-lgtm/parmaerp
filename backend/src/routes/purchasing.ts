import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler';
import { conflict, notFound } from '../lib/errors';
import { pageParams, paged } from '../lib/pagination';
import { prisma, transaction } from '../lib/prisma';
import { nextNumber } from '../lib/sequence';
import { requirePermission } from '../middleware/auth';
import * as P from '../services/purchase.service';
import { grnPdf, poPdf } from '../services/pdf.service';

export const purchaseRouter = Router();
const num = z.coerce.number();
const opt = <T extends z.ZodTypeAny>(s: T) => s.optional().nullable().transform((v) => v ?? undefined);

// Requisitions
purchaseRouter.get('/requisitions', requirePermission('purchase:read'), ah(async (_req, res) => res.json(await prisma.purchaseRequisition.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { items: { include: { rawMaterial: { select: { code: true, name: true, uom: true } } } } } }))));
purchaseRouter.post('/requisitions', requirePermission('purchase:create'), ah(async (req, res) => {
  const b = z.object({ notes: opt(z.string()), items: z.array(z.object({ rawMaterialId: z.string(), quantity: num.positive() })).min(1) }).parse(req.body);
  res.status(201).json(await transaction(async (tx) => tx.purchaseRequisition.create({ data: { prNumber: await nextNumber(tx, 'PR'), notes: b.notes, requestedById: req.user!.id, status: 'SUBMITTED', items: { create: b.items } }, include: { items: true } })));
}));
purchaseRouter.post('/requisitions/:id/decision', requirePermission('purchase:approve'), ah(async (req, res) => {
  const { approve } = z.object({ approve: z.boolean() }).parse(req.body);
  res.json(await prisma.purchaseRequisition.update({ where: { id: req.params.id }, data: { status: approve ? 'APPROVED' : 'REJECTED' } }));
}));
/** One click: auto-draft a requisition for every material at/below reorder level. */
purchaseRouter.post('/requisitions/auto', requirePermission('purchase:create'), ah(async (req, res) => {
  const { stockByMaterial } = await import('../services/inventory.service');
  const [mats, stock] = await Promise.all([prisma.rawMaterial.findMany({ where: { status: 'ACTIVE', reorderLevel: { gt: 0 } } }), stockByMaterial()]);
  const items = mats.filter((m) => Number(stock.get(m.id)?.usable ?? 0) <= Number(m.reorderLevel)).map((m) => ({ rawMaterialId: m.id, quantity: Math.max(Number(m.reorderLevel) * 2 - Number(stock.get(m.id)?.usable ?? 0), 1) }));
  if (!items.length) return void res.json({ created: false, message: 'Nothing is below its reorder level.' });
  const pr = await transaction(async (tx) => tx.purchaseRequisition.create({ data: { prNumber: await nextNumber(tx, 'PR'), notes: 'Auto-generated from reorder levels', requestedById: req.user!.id, status: 'SUBMITTED', items: { create: items } }, include: { items: true } }));
  res.status(201).json({ created: true, requisition: pr });
}));

// Purchase orders
purchaseRouter.get('/orders', requirePermission('purchase:read'), ah(async (req, res) => {
  const { skip, take, page, pageSize, q } = pageParams(req);
  const { status, supplierId } = req.query as Record<string, string | undefined>;
  const where: any = { ...(status && { status }), ...(supplierId && { supplierId }), ...(q && { OR: [{ poNumber: { contains: q, mode: 'insensitive' } }, { supplier: { name: { contains: q, mode: 'insensitive' } } }] }) };
  const [rows, total] = await Promise.all([prisma.purchaseOrder.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: { supplier: { select: { name: true } }, _count: { select: { items: true } } } }), prisma.purchaseOrder.count({ where })]);
  res.json(paged(rows, total, page, pageSize));
}));
purchaseRouter.get('/orders/:id', requirePermission('purchase:read'), ah(async (req, res) => {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id }, include: { supplier: true, items: { include: { rawMaterial: { select: { code: true, name: true, uom: true } } } }, grns: { select: { id: true, grnNumber: true, receivedAt: true } }, invoices: { select: { id: true, invoiceNumber: true, total: true, status: true } } } });
  if (!po) throw notFound();
  res.json(po);
}));
purchaseRouter.post('/orders', requirePermission('purchase:create'), ah(async (req, res) => {
  const b = z.object({ supplierId: z.string(), expectedDate: z.coerce.date().optional(), terms: opt(z.string()), requisitionId: opt(z.string()), items: z.array(z.object({ rawMaterialId: z.string(), quantity: num.positive(), unitPrice: num.min(0), taxPct: num.min(0).max(40).optional() })).min(1) }).parse(req.body);
  res.status(201).json(await P.createPo(b, req.user!.id));
}));
purchaseRouter.post('/orders/:id/approve', requirePermission('purchase:approve'), ah(async (req, res) => res.json(await P.approvePo(req.params.id, req.user!.id, req.user!.role))));
purchaseRouter.post('/orders/:id/cancel', requirePermission('purchase:update'), ah(async (req, res) => {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
  if (!po || ['RECEIVED', 'CLOSED', 'PARTIALLY_RECEIVED'].includes(po.status)) throw conflict('PO cannot be cancelled once goods are received');
  res.json(await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'CANCELLED' } }));
}));
purchaseRouter.get('/orders/:id/pdf', requirePermission('purchase:read'), ah(async (req, res) => res.type('application/pdf').send(await poPdf(req.params.id))));

// GRN
purchaseRouter.get('/grn', requirePermission('purchase:read'), ah(async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req);
  const [rows, total] = await Promise.all([prisma.grn.findMany({ skip, take, orderBy: { createdAt: 'desc' }, include: { supplier: { select: { name: true } }, po: { select: { poNumber: true } }, _count: { select: { items: true } } } }), prisma.grn.count()]);
  res.json(paged(rows, total, page, pageSize));
}));
purchaseRouter.get('/grn/:id', requirePermission('purchase:read'), ah(async (req, res) => res.json(await prisma.grn.findUnique({ where: { id: req.params.id }, include: { supplier: true, po: true, items: { include: { rawMaterial: true, lot: { select: { id: true, status: true, barcode: true } } } } } }))));
purchaseRouter.post('/grn', requirePermission('purchase:grn'), ah(async (req, res) => {
  const b = z.object({
    poId: opt(z.string()), supplierId: opt(z.string()), warehouseId: z.string(), challanNo: opt(z.string()), vehicleNo: opt(z.string()), notes: opt(z.string()),
    items: z.array(z.object({ poItemId: opt(z.string()), rawMaterialId: z.string(), lotNumber: z.string().min(1), supplierLot: opt(z.string()), quantity: num.positive(), rejectedQty: num.min(0).optional(), unitCost: num.min(0).optional(), mfgDate: z.coerce.date().optional(), expiryDate: z.coerce.date().optional(), binId: opt(z.string()), coaDocumentId: opt(z.string()) })).min(1),
  }).parse(req.body);
  res.status(201).json(await P.postGrn(b, req.user!.id));
}));
purchaseRouter.get('/grn/:id/pdf', requirePermission('purchase:read'), ah(async (req, res) => res.type('application/pdf').send(await grnPdf(req.params.id))));

// Supplier invoices
purchaseRouter.get('/invoices', requirePermission('purchase:read'), ah(async (req, res) => {
  const { skip, take, page, pageSize, q } = pageParams(req);
  const { status, supplierId } = req.query as Record<string, string | undefined>;
  const where: any = { ...(status && { status }), ...(supplierId && { supplierId }), ...(q && { OR: [{ invoiceNumber: { contains: q, mode: 'insensitive' } }, { supplier: { name: { contains: q, mode: 'insensitive' } } }] }) };
  const [rows, total] = await Promise.all([prisma.supplierInvoice.findMany({ where, skip, take, orderBy: { invoiceDate: 'desc' }, include: { supplier: { select: { name: true } }, po: { select: { poNumber: true } } } }), prisma.supplierInvoice.count({ where })]);
  res.json(paged(rows, total, page, pageSize));
}));
purchaseRouter.get('/invoices/:id', requirePermission('purchase:read'), ah(async (req, res) => {
  const i = await prisma.supplierInvoice.findUnique({ where: { id: req.params.id }, include: { supplier: true, po: true, grn: { select: { id: true, grnNumber: true } }, items: { include: { rawMaterial: { select: { code: true, name: true } } } }, document: { select: { id: true, fileName: true } } } });
  if (!i) throw notFound();
  res.json(i);
}));
const InvoiceBody = z.object({
  invoiceNumber: z.string().min(1), invoiceDate: z.coerce.date(), supplierId: z.string(), gstin: opt(z.string()), poId: opt(z.string()), subtotal: num, taxTotal: num, total: num,
  items: z.array(z.object({ rawMaterialId: opt(z.string()), description: z.string(), hsnCode: opt(z.string()), quantity: num.positive(), unit: opt(z.string()), unitPrice: num.min(0), taxPct: num.min(0).optional(), amount: num })).min(1),
});
/** Dry-run: see the match result before saving. */
purchaseRouter.post('/invoices/match', requirePermission('purchase:read'), ah(async (req, res) => res.json(await P.matchInvoice(InvoiceBody.parse(req.body) as any))));
purchaseRouter.post('/invoices', requirePermission('purchase:create'), ah(async (req, res) => res.status(201).json(await P.saveInvoice(InvoiceBody.parse(req.body) as any, { source: 'MANUAL', userId: req.user!.id }))));
purchaseRouter.post('/invoices/:id/approve', requirePermission('purchase:approve'), ah(async (req, res) => res.json(await P.approveInvoice(req.params.id, req.user!.id, req.body?.warehouseId))));
purchaseRouter.post('/invoices/:id/reject', requirePermission('purchase:approve'), ah(async (req, res) => res.json(await prisma.supplierInvoice.update({ where: { id: req.params.id }, data: { status: 'REJECTED' } }))));
