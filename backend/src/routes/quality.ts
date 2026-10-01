import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler';
import { notFound } from '../lib/errors';
import { pageParams, paged } from '../lib/pagination';
import { prisma } from '../lib/prisma';
import { requirePermission } from '../middleware/auth';
import * as Q from '../services/qc.service';
import { qcReportPdf } from '../services/pdf.service';
import * as E from '../services/expiry.service';

export const qcRouter = Router();
const num = z.coerce.number();
const opt = <T extends z.ZodTypeAny>(s: T) => s.optional().nullable().transform((v) => v ?? undefined);

qcRouter.get('/samples', requirePermission('qc:read'), ah(async (req, res) => {
  const { skip, take, page, pageSize, q } = pageParams(req);
  const { status, type } = req.query as Record<string, string | undefined>;
  const where: any = { ...(status && { status }), ...(type && { type }), ...(q && { sampleNumber: { contains: q, mode: 'insensitive' } }) };
  const [rows, total] = await Promise.all([
    prisma.qcSample.findMany({ where, skip, take, orderBy: { collectedAt: 'desc' }, include: { materialLot: { select: { lotNumber: true, rawMaterial: { select: { code: true, name: true } } } }, batch: { select: { batchNumber: true, product: { select: { name: true } } } }, coa: { select: { coaNumber: true, documentId: true } }, _count: { select: { results: true } } } }),
    prisma.qcSample.count({ where }),
  ]);
  res.json(paged(rows, total, page, pageSize));
}));
qcRouter.get('/samples/:id', requirePermission('qc:read'), ah(async (req, res) => {
  const s = await prisma.qcSample.findUnique({ where: { id: req.params.id }, include: { results: true, coa: true, materialLot: { include: { rawMaterial: true } }, batch: { include: { product: true } } } });
  if (!s) throw notFound();
  res.json(s);
}));
qcRouter.get('/samples/:id/specs', requirePermission('qc:read'), ah(async (req, res) => res.json(await Q.specsForSample(req.params.id))));
qcRouter.post('/samples', requirePermission('qc:create'), ah(async (req, res) => {
  const b = z.object({ type: z.enum(['RAW_MATERIAL', 'IN_PROCESS', 'FINISHED_PRODUCT']), materialLotId: opt(z.string()), batchId: opt(z.string()), quantity: opt(num), remarks: opt(z.string()) }).parse(req.body);
  res.status(201).json(await Q.createSample(b, req.user!.id));
}));
qcRouter.put('/samples/:id/results', requirePermission('qc:update'), ah(async (req, res) => {
  const results = z.array(z.object({ parameter: z.string().min(1), specification: opt(z.string()), resultValue: z.string().min(1), numericValue: opt(num), lowerLimit: opt(num), upperLimit: opt(num), unit: opt(z.string()), passed: z.boolean().optional() })).parse(req.body.results);
  res.json(await Q.recordResults(req.params.id, results, req.user!.id));
}));
qcRouter.post('/samples/:id/finalise', requirePermission('qc:update'), ah(async (req, res) => res.json(await Q.finaliseSample(req.params.id, req.user!.id, req.user!.role, req.body?.remarks))));
qcRouter.get('/samples/:id/report', requirePermission('qc:read'), ah(async (req, res) => res.type('application/pdf').send(await qcReportPdf(req.params.id, req.query.coa === 'true'))));

// ───────── Expiry & recalls ─────────
export const expiryRouter = Router();
expiryRouter.get('/', requirePermission('expiry:read'), ah(async (req, res) => res.json(await E.expiryOverview(Number(req.query.days) || undefined))));
expiryRouter.post('/sweep', requirePermission('expiry:update'), ah(async (_req, res) => res.json(await E.runSweep())));
expiryRouter.post('/write-off/:lotId', requirePermission('expiry:update'), ah(async (req, res) => res.json(await E.writeOffExpiredLot(req.params.lotId, req.user!.id, req.body?.reason))));
expiryRouter.get('/recalls', requirePermission('expiry:read'), ah(async (_req, res) => res.json(await prisma.recall.findMany({ orderBy: { createdAt: 'desc' }, include: { batch: { select: { batchNumber: true, product: { select: { name: true } } } } } }))));
expiryRouter.post('/recalls', requirePermission('expiry:recall'), ah(async (req, res) => {
  const b = z.object({ batchId: z.string(), reason: z.string().min(10), classification: z.enum(['CLASS_I', 'CLASS_II', 'CLASS_III']).default('CLASS_II') }).parse(req.body);
  res.status(201).json(await E.initiateRecall(b.batchId, b.reason, b.classification, req.user!.id));
}));
expiryRouter.post('/recalls/:id/close', requirePermission('expiry:recall'), ah(async (req, res) => {
  const b = z.object({ quantityRecovered: num.min(0) }).parse(req.body);
  res.json(await prisma.recall.update({ where: { id: req.params.id }, data: { status: 'CLOSED', closedAt: new Date(), quantityRecovered: b.quantityRecovered } }));
}));
