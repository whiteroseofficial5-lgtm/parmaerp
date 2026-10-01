import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler';
import { notFound } from '../lib/errors';
import { pageParams, paged } from '../lib/pagination';
import { prisma, transaction } from '../lib/prisma';
import { nextNumber } from '../lib/sequence';
import { qrPng, traceUrl } from '../lib/qr';
import { requirePermission } from '../middleware/auth';
import * as F from '../services/formula.service';
import * as B from '../services/batch.service';
import { bmrPdf, bprPdf, storePdf, validationPdf } from '../services/pdf.service';
import { bmrLikeFromDb, validateBmr } from '../services/ai/validation';

const num = z.coerce.number();
const opt = <T extends z.ZodTypeAny>(s: T) => s.optional().nullable().transform((v) => v ?? undefined);

// ───────── Formulas & BOM ─────────
export const formulasRouter = Router();
const FormulaBody = z.object({
  productId: z.string(), baseBatchSize: num.positive(), baseBatchUnit: z.string().optional(), expectedYieldPct: num.min(1).max(100).optional(), instructions: z.string().optional(), changeReason: z.string().optional(),
  items: z.array(z.object({ rawMaterialId: z.string(), quantity: num.positive(), unit: z.string().min(1), wastagePct: num.min(0).max(50).optional(), stage: z.string().optional() })).min(1),
});

formulasRouter.get('/', requirePermission('formula:read'), ah(async (req, res) => {
  const { skip, take, page, pageSize, q } = pageParams(req);
  const { status, productId } = req.query as Record<string, string | undefined>;
  const where: any = { ...(status && { status }), ...(productId && { productId }), ...(q && { product: { name: { contains: q, mode: 'insensitive' } } }) };
  const [rows, total] = await Promise.all([prisma.formula.findMany({ where, skip, take, orderBy: [{ productId: 'asc' }, { version: 'desc' }], include: { product: { select: { name: true, code: true, strength: true } }, _count: { select: { items: true } } } }), prisma.formula.count({ where })]);
  res.json(paged(rows, total, page, pageSize));
}));
formulasRouter.get('/diff', requirePermission('formula:read'), ah(async (req, res) => res.json(await F.diffVersions(String(req.query.from), String(req.query.to)))));
formulasRouter.get('/:id', requirePermission('formula:read'), ah(async (req, res) => {
  const f = await prisma.formula.findUnique({ where: { id: req.params.id }, include: { product: true, items: { include: { rawMaterial: { select: { code: true, name: true, uom: true, category: true } } }, orderBy: { sequence: 'asc' } }, history: { orderBy: { createdAt: 'desc' } } } });
  if (!f) throw notFound();
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set([f.createdById, f.approvedById, ...f.history.map((h) => h.userId)].filter(Boolean) as string[])] } }, select: { id: true, name: true } });
  res.json({ ...f, users });
}));
formulasRouter.get('/:id/cost', requirePermission('formula:read'), ah(async (req, res) => res.json(await F.computeFormulaCost(prisma as any, req.params.id, req.query.batchSize as string | undefined))));
formulasRouter.post('/', requirePermission('formula:create'), ah(async (req, res) => res.status(201).json(await F.createFormula(FormulaBody.parse(req.body), req.user!.id))));
formulasRouter.patch('/:id', requirePermission('formula:update'), ah(async (req, res) => res.json(await F.updateFormula(req.params.id, FormulaBody.partial().parse(req.body), req.user!.id))));
formulasRouter.post('/:id/new-version', requirePermission('formula:create'), ah(async (req, res) => res.status(201).json(await F.newVersionFrom(req.params.id, req.user!.id, z.object({ changeReason: z.string().min(5) }).parse(req.body).changeReason))));
formulasRouter.post('/:id/submit', requirePermission('formula:submit'), ah(async (req, res) => res.json(await F.submitFormula(req.params.id, req.user!.id))));
formulasRouter.post('/:id/approve', requirePermission('formula:approve'), ah(async (req, res) => res.json(await F.approveFormula(req.params.id, req.user!.id, req.user!.role, req.body?.remarks))));
formulasRouter.post('/:id/reject', requirePermission('formula:approve'), ah(async (req, res) => res.json(await F.rejectFormula(req.params.id, req.user!.id, z.object({ remarks: z.string().min(3) }).parse(req.body).remarks))));

export const bomRouter = Router();
bomRouter.get('/:productId', requirePermission('bom:read'), ah(async (req, res) => res.json(await F.getBom(req.params.productId, req.query.batchSize as string | undefined))));

// ───────── Batches (BMR) ─────────
export const batchesRouter = Router();
batchesRouter.get('/', requirePermission('batch:read'), ah(async (req, res) => {
  const { skip, take, page, pageSize, q } = pageParams(req);
  const { status, qcStatus, productId, from, to } = req.query as Record<string, string | undefined>;
  const where: any = { ...(status && { status }), ...(qcStatus && { qcStatus }), ...(productId && { productId }), ...((from || to) && { mfgDate: { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } }), ...(q && { OR: [{ batchNumber: { contains: q, mode: 'insensitive' } }, { product: { name: { contains: q, mode: 'insensitive' } } }] }) };
  const [rows, total] = await Promise.all([prisma.batch.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: { product: { select: { name: true, code: true, strength: true } }, operator: { select: { name: true } } } }), prisma.batch.count({ where })]);
  res.json(paged(rows, total, page, pageSize));
}));
batchesRouter.get('/:id', requirePermission('batch:read'), ah(async (req, res) => {
  const b = await prisma.batch.findUnique({ where: { id: req.params.id }, include: B.batchDetailInclude });
  if (!b) throw notFound();
  const signatures = await prisma.signature.findMany({ where: { entity: 'Batch', entityId: b.id }, include: { user: { select: { name: true, role: true } } }, orderBy: { createdAt: 'asc' } });
  res.json({ ...b, signatures, traceUrl: traceUrl(b.batchNumber) });
}));
batchesRouter.post('/', requirePermission('batch:create'), ah(async (req, res) => {
  const b = z.object({ productId: z.string(), batchSize: num.positive(), mfgDate: z.coerce.date().optional(), operatorId: opt(z.string()), workOrderId: opt(z.string()), remarks: opt(z.string()), batchNumber: opt(z.string().min(3)) }).parse(req.body);
  res.status(201).json(await B.createBatch(b, req.user!.id));
}));
batchesRouter.post('/:id/approve', requirePermission('batch:approve'), ah(async (req, res) => res.json(await B.approveBatch(req.params.id, req.user!.id, req.user!.role, req.body?.remarks))));
batchesRouter.post('/:id/start', requirePermission('batch:start'), ah(async (req, res) => res.json(await B.startProduction(req.params.id, req.user!.id))));
batchesRouter.post('/:id/complete', requirePermission('batch:complete'), ah(async (req, res) => {
  const b = z.object({ actualYield: num.positive(), finishedGoodsWarehouseId: z.string(), binId: opt(z.string()), remarks: opt(z.string()), actualConsumption: z.array(z.object({ rawMaterialId: z.string(), actualQty: num.min(0) })).optional() }).parse(req.body);
  res.json(await B.completeProduction(req.params.id, b, req.user!.id));
}));
batchesRouter.post('/:id/release', requirePermission('batch:release'), ah(async (req, res) => res.json(await B.releaseBatch(req.params.id, req.user!.id, req.body?.remarks))));
batchesRouter.post('/:id/reject', requirePermission('batch:reject'), ah(async (req, res) => res.json(await B.rejectBatch(req.params.id, req.user!.id, z.object({ remarks: z.string().min(3) }).parse(req.body).remarks))));
batchesRouter.post('/:id/cancel', requirePermission('batch:update'), ah(async (req, res) => res.json(await B.cancelBatch(req.params.id, req.user!.id, req.body?.remarks))));

batchesRouter.get('/:id/qr', requirePermission('batch:read'), ah(async (req, res) => {
  const b = await prisma.batch.findUnique({ where: { id: req.params.id } });
  if (!b) throw notFound();
  res.type('png').send(await qrPng(traceUrl(b.batchNumber), 320));
}));
batchesRouter.get('/:id/pdf/:kind', requirePermission('batch:read'), ah(async (req, res) => {
  const b = await prisma.batch.findUnique({ where: { id: req.params.id } });
  if (!b) throw notFound();
  const kind = req.params.kind === 'bpr' ? 'bpr' : 'bmr';
  const buf = await (kind === 'bpr' ? bprPdf(b.id) : bmrPdf(b.id));
  if (req.query.save === 'true') await storePdf(buf, { title: `${kind.toUpperCase()} ${b.batchNumber}`, type: kind === 'bpr' ? 'BPR' : 'BMR', entityType: 'Batch', entityId: b.id, userId: req.user!.id, fileName: `${kind.toUpperCase()}-${b.batchNumber}.pdf` });
  res.type('application/pdf').set('Content-Disposition', `inline; filename="${kind.toUpperCase()}-${b.batchNumber}.pdf"`).send(buf);
}));
/** AI/rule-based batch record validation for a persisted batch. ?format=pdf returns the validation report. */
batchesRouter.get('/:id/validate', requirePermission('batch:read'), ah(async (req, res) => {
  const like = await bmrLikeFromDb(req.params.id);
  if (!like) throw notFound();
  const report = await validateBmr(like, { narrative: true });
  if (req.query.format === 'pdf') return void res.type('application/pdf').send(await validationPdf('Batch Record Validation Report', like.batchNumber ?? '', report));
  res.json(report);
}));

// Public traceability (QR landing page). No auth; the payload deliberately excludes cost and personnel data.
export const publicTraceRouter = Router();
publicTraceRouter.get('/trace/:batchNumber', ah(async (req, res) => res.json(await B.traceBatch(req.params.batchNumber))));

// ───────── Production management ─────────
export const productionRouter = Router();
productionRouter.get('/work-orders', requirePermission('production:read'), ah(async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req);
  const { status, from, to } = req.query as Record<string, string | undefined>;
  const where: any = { ...(status && { status }), ...((from || to) && { plannedStart: { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } }) };
  const [rows, total] = await Promise.all([prisma.workOrder.findMany({ where, skip, take, orderBy: [{ plannedStart: 'asc' }], include: { product: { select: { name: true, code: true } }, shift: true, batch: { select: { id: true, batchNumber: true, status: true } }, operators: { include: { user: { select: { id: true, name: true } } } } } }), prisma.workOrder.count({ where })]);
  res.json(paged(rows, total, page, pageSize));
}));
productionRouter.post('/work-orders', requirePermission('production:create'), ah(async (req, res) => {
  const b = z.object({ productId: z.string(), quantity: num.positive(), plannedStart: z.coerce.date(), plannedEnd: z.coerce.date(), shiftId: opt(z.string()), lineName: opt(z.string()), priority: z.coerce.number().int().min(1).max(5).default(3), notes: opt(z.string()), operatorIds: z.array(z.string()).default([]) }).parse(req.body);
  const { operatorIds, ...rest } = b;
  res.status(201).json(await transaction(async (tx) => tx.workOrder.create({ data: { ...rest, woNumber: await nextNumber(tx, 'WO'), status: 'SCHEDULED', operators: { create: operatorIds.map((userId) => ({ userId })) } }, include: { operators: true } })));
}));
productionRouter.patch('/work-orders/:id', requirePermission('production:update'), ah(async (req, res) => {
  const b = z.object({ status: z.enum(['PLANNED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(), progressPct: z.coerce.number().int().min(0).max(100).optional(), plannedStart: z.coerce.date().optional(), plannedEnd: z.coerce.date().optional(), shiftId: opt(z.string()), lineName: opt(z.string()), notes: opt(z.string()) }).parse(req.body);
  res.json(await prisma.workOrder.update({ where: { id: req.params.id }, data: b }));
}));
productionRouter.post('/work-orders/:id/operators', requirePermission('production:update'), ah(async (req, res) => {
  const b = z.object({ userIds: z.array(z.string()).min(1), task: opt(z.string()) }).parse(req.body);
  await transaction(async (tx) => { for (const userId of b.userIds) await tx.operatorAssignment.upsert({ where: { workOrderId_userId: { workOrderId: req.params.id, userId } }, create: { workOrderId: req.params.id, userId, task: b.task }, update: { task: b.task } }); });
  res.json({ ok: true });
}));
productionRouter.post('/work-orders/:id/create-batch', requirePermission('batch:create'), ah(async (req, res) => {
  const wo = await prisma.workOrder.findUnique({ where: { id: req.params.id }, include: { operators: true } });
  if (!wo) throw notFound();
  res.status(201).json(await B.createBatch({ productId: wo.productId, batchSize: wo.quantity.toString(), mfgDate: wo.plannedStart, workOrderId: wo.id, operatorId: wo.operators[0]?.userId }, req.user!.id));
}));
productionRouter.get('/schedule', requirePermission('production:read'), ah(async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 7 * 86_400_000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date(Date.now() + 30 * 86_400_000);
  res.json(await prisma.workOrder.findMany({ where: { plannedStart: { lte: to }, plannedEnd: { gte: from }, status: { not: 'CANCELLED' } }, orderBy: { plannedStart: 'asc' }, include: { product: { select: { name: true } }, shift: true, operators: { include: { user: { select: { name: true } } } } } }));
}));
productionRouter.get('/plans', requirePermission('production:read'), ah(async (_req, res) => res.json(await prisma.productionPlan.findMany({ orderBy: { periodStart: 'desc' }, take: 50, include: { items: { include: { product: { select: { name: true } } } } } }))));
productionRouter.post('/plans', requirePermission('production:create'), ah(async (req, res) => {
  const b = z.object({ periodStart: z.coerce.date(), periodEnd: z.coerce.date(), notes: opt(z.string()), items: z.array(z.object({ productId: z.string(), plannedQty: num.positive(), plannedBatches: z.coerce.number().int().min(1).default(1) })).min(1) }).parse(req.body);
  res.status(201).json(await transaction(async (tx) => tx.productionPlan.create({ data: { planNumber: await nextNumber(tx, 'PLAN'), periodStart: b.periodStart, periodEnd: b.periodEnd, notes: b.notes, createdById: req.user!.id, items: { create: b.items } }, include: { items: true } })));
}));
