import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { ah } from '../lib/asyncHandler';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { pageParams, paged } from '../lib/pagination';
import { basePrisma, prisma } from '../lib/prisma';
import { readStored, saveFile } from '../lib/storage';
import { can } from '../config/permissions';
import { requirePermission } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { dashboard } from '../services/dashboard.service';
import { analyticsBundle, expiryRisk, materialForecast, productionNeeds, supplierScores } from '../services/ai/forecast';
import { buildReport, exportReport, REPORTS } from '../services/report.service';
import * as J from '../services/ai/jobs.service';
import { aiSearch } from '../services/ai/search';
import { validateBmr } from '../services/ai/validation';
import { validationPdf } from '../services/pdf.service';
import { env } from '../config/env';

const opt = <T extends z.ZodTypeAny>(s: T) => s.optional().nullable().transform((v) => v ?? undefined);

// ───────── Dashboard & analytics ─────────
export const dashboardRouter = Router();
dashboardRouter.get('/', requirePermission('dashboard:read'), ah(async (_req, res) => res.json(await dashboard())));

export const analyticsRouter = Router();
analyticsRouter.use(requirePermission('analytics:read'));
analyticsRouter.get('/', ah(async (_req, res) => res.json(await analyticsBundle())));
analyticsRouter.get('/materials', ah(async (req, res) => res.json(await materialForecast(Number(req.query.months) || 12, Number(req.query.horizon) || 3))));
analyticsRouter.get('/production-needs', ah(async (_req, res) => res.json(await productionNeeds())));
analyticsRouter.get('/expiry-risk', ah(async (_req, res) => res.json(await expiryRisk())));
analyticsRouter.get('/suppliers', ah(async (_req, res) => res.json(await supplierScores())));

// ───────── Reports ─────────
export const reportsRouter = Router();
reportsRouter.get('/', requirePermission('report:read'), (_req, res) => res.json(Object.keys(REPORTS)));
reportsRouter.get('/:name', requirePermission('report:read'), ah(async (req, res) => {
  const q = req.query as Record<string, string>;
  if (req.params.name === 'audit' && !can(req.user!.role, 'audit:read')) throw forbidden('Audit reports require audit access');
  const report = await buildReport(req.params.name, q);
  const format = (q.format ?? 'json') as 'json' | 'csv' | 'xlsx' | 'pdf';
  if (format === 'json') return void res.json(report);
  if (!can(req.user!.role, 'report:export')) throw forbidden('Export not permitted for your role');
  const out = await exportReport(report, format);
  res.type(out.mime).set('Content-Disposition', `attachment; filename="${req.params.name}-${new Date().toISOString().slice(0, 10)}.${out.ext}"`).send(out.buffer);
}));

// ───────── Audit trail ─────────
export const auditRouter = Router();
auditRouter.get('/', requirePermission('audit:read'), ah(async (req, res) => {
  const { skip, take, page, pageSize, q } = pageParams(req, 50);
  const { entity, userId, action, from, to, entityId } = req.query as Record<string, string | undefined>;
  const where: any = { ...(entity && { entity }), ...(userId && { userId }), ...(action && { action }), ...(entityId && { entityId }), ...((from || to) && { createdAt: { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } }), ...(q && { OR: [{ userEmail: { contains: q, mode: 'insensitive' } }, { entity: { contains: q, mode: 'insensitive' } }, { entityId: q }] }) };
  const [rows, total] = await Promise.all([basePrisma.auditLog.findMany({ where, skip, take, orderBy: { id: 'desc' } }), basePrisma.auditLog.count({ where })]);
  res.json(paged(rows.map((r) => ({ ...r, id: r.id.toString() })), total, page, pageSize));
}));
auditRouter.get('/entities', requirePermission('audit:read'), ah(async (_req, res) => res.json((await basePrisma.auditLog.findMany({ distinct: ['entity'], select: { entity: true }, orderBy: { entity: 'asc' } })).map((e) => e.entity))));

// ───────── Notifications ─────────
export const notificationsRouter = Router();
const mine = (req: any) => ({ OR: [{ userId: req.user.id }, { userId: null, targetRole: req.user.role }, { userId: null, targetRole: null }] });
notificationsRouter.get('/', requirePermission('notification:read'), ah(async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req, 30);
  const unreadOnly = req.query.unread === 'true';
  const where: any = { AND: [mine(req), unreadOnly ? { readAt: null } : {}] };
  const [rows, total, unread] = await Promise.all([basePrisma.notification.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }), basePrisma.notification.count({ where }), basePrisma.notification.count({ where: { AND: [mine(req), { readAt: null }] } })]);
  res.json({ ...paged(rows, total, page, pageSize), unread });
}));
notificationsRouter.get('/count', requirePermission('notification:read'), ah(async (req, res) => res.json({ unread: await basePrisma.notification.count({ where: { AND: [mine(req), { readAt: null }] } }) })));
notificationsRouter.post('/:id/read', requirePermission('notification:read'), ah(async (req, res) => { await basePrisma.notification.updateMany({ where: { id: req.params.id, AND: [mine(req)] }, data: { readAt: new Date() } }); res.json({ ok: true }); }));
notificationsRouter.post('/read-all', requirePermission('notification:read'), ah(async (req, res) => { await basePrisma.notification.updateMany({ where: { AND: [mine(req), { readAt: null }] }, data: { readAt: new Date() } }); res.json({ ok: true }); }));

// ───────── Company profile (used in PDF headers) ─────────
export const companyRouter = Router();
companyRouter.get('/', ah(async (_req, res) => res.json(await prisma.companyProfile.findUnique({ where: { id: 'default' } }))));
companyRouter.put('/', requirePermission('user:update'), ah(async (req, res) => {
  const b = z.object({ name: z.string().min(2), address: opt(z.string()), gstin: opt(z.string()), drugLicense: opt(z.string()), phone: opt(z.string()), email: opt(z.string()) }).parse(req.body);
  res.json(await prisma.companyProfile.upsert({ where: { id: 'default' }, create: { id: 'default', ...b }, update: b }));
}));
companyRouter.post('/logo', requirePermission('user:update'), upload.single('file'), ah(async (req, res) => {
  if (!req.file || !req.file.mimetype.startsWith('image/')) throw badRequest('Upload a PNG or JPEG logo');
  const f = await saveFile(req.file.buffer, req.file.originalname, 'branding');
  res.json(await prisma.companyProfile.upsert({ where: { id: 'default' }, create: { id: 'default', name: 'PharmaERP Laboratories', logoPath: f.storagePath }, update: { logoPath: f.storagePath } }));
}));

// ───────── AI: document processing, validation, search ─────────
export const aiRouter = Router();
aiRouter.get('/status', requirePermission('ai:read'), (_req, res) => res.json({ engine: env.ANTHROPIC_API_KEY ? 'claude-vision' : env.OCR_FALLBACK === 'true' ? 'tesseract-fallback' : 'disabled', model: env.ANTHROPIC_API_KEY ? env.AI_MODEL : null }));

aiRouter.post('/bmr/upload', requirePermission('ai:bmr'), upload.array('files', 10), ah(async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) throw badRequest('Attach at least one file (PDF, scan, image or handwritten form photo)');
  res.status(202).json(await Promise.all(files.map((f) => J.createJob('BMR', f, req.user!.id))));
}));
aiRouter.post('/invoice/upload', requirePermission('ai:invoice'), upload.array('files', 20), ah(async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) throw badRequest('Attach at least one invoice file');
  res.status(202).json(await Promise.all(files.map((f) => J.createJob('INVOICE', f, req.user!.id))));
}));

aiRouter.get('/jobs', requirePermission('ai:read'), ah(async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req);
  const { kind, status } = req.query as Record<string, string | undefined>;
  const where: any = { ...(kind && { kind }), ...(status && { status }) };
  const [rows, total] = await Promise.all([prisma.aiJob.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: { document: { select: { id: true, fileName: true, mimeType: true } } } } as any), prisma.aiJob.count({ where })]);
  res.json(paged((rows as any[]).map(({ extracted, ...r }) => r), total, page, pageSize));
}));
aiRouter.get('/jobs/:id', requirePermission('ai:read'), ah(async (req, res) => {
  const j = await prisma.aiJob.findUnique({ where: { id: req.params.id }, include: { document: { select: { id: true, fileName: true, mimeType: true } } } });
  if (!j) throw notFound();
  res.json(j);
}));
aiRouter.get('/jobs/:id/file', requirePermission('ai:read'), ah(async (req, res) => {
  const j = await prisma.aiJob.findUnique({ where: { id: req.params.id }, include: { document: true } });
  if (!j) throw notFound();
  res.type(j.document.mimeType).set('Content-Disposition', `inline; filename="${j.document.fileName}"`).send(await readStored(j.document.storagePath));
}));
aiRouter.put('/jobs/:id/corrections', requirePermission('ai:read'), ah(async (req, res) => {
  const perm = (await prisma.aiJob.findUnique({ where: { id: req.params.id } }))?.kind === 'BMR' ? 'ai:bmr' : 'ai:invoice';
  if (!can(req.user!.role, perm)) throw forbidden();
  res.json(await J.saveCorrections(req.params.id, req.body.corrected, req.user!.id));
}));
aiRouter.post('/jobs/:id/reprocess', requirePermission('ai:read'), ah(async (req, res) => { await J.processJob(req.params.id); res.json(await prisma.aiJob.findUnique({ where: { id: req.params.id } })); }));
aiRouter.post('/jobs/:id/reject', requirePermission('ai:read'), ah(async (req, res) => res.json(await J.rejectJob(req.params.id, req.user!.id))));
aiRouter.post('/jobs/:id/commit', requirePermission('ai:read'), ah(async (req, res) => {
  const job = await prisma.aiJob.findUnique({ where: { id: req.params.id } });
  if (!job) throw notFound();
  if (!can(req.user!.role, job.kind === 'BMR' ? 'ai:bmr' : 'ai:invoice')) throw forbidden();
  if (job.kind === 'BMR') {
    const b = z.object({ deductStock: z.boolean().default(false), finishedGoodsWarehouseId: opt(z.string()) }).parse(req.body ?? {});
    return void res.status(201).json(await J.commitBmrJob(job.id, req.user!.id, b));
  }
  const b = z.object({ autoReceive: z.boolean().default(false), warehouseId: opt(z.string()) }).parse(req.body ?? {});
  res.status(201).json(await J.commitInvoiceJob(job.id, req.user!.id, b));
}));

aiRouter.post('/validate', requirePermission('ai:validate'), ah(async (req, res) => {
  const report = await validateBmr(req.body.record, { narrative: true });
  if (req.query.format === 'pdf') return void res.type('application/pdf').send(await validationPdf('Batch Record Validation Report', req.body.record?.batchNumber ?? 'Uploaded record', report));
  res.json(report);
}));

aiRouter.post('/search', requirePermission('ai:search'), ah(async (req, res) => {
  const { question } = z.object({ question: z.string().min(3).max(500) }).parse(req.body);
  const result = await aiSearch(question, req.user!.role);
  await basePrisma.auditLog.create({ data: { userId: req.user!.id, userEmail: req.user!.email, userRole: req.user!.role, action: 'AI_SEARCH', entity: 'Search', after: { question, tools: result.toolsUsed } } });
  res.json(result);
}));

// ───────── Document management ─────────
export const documentsRouter = Router();
export const publicShareRouter = Router();
const canSee = (doc: { allowedRoles: string[] }, role: string) => !doc.allowedRoles.length || doc.allowedRoles.includes(role) || role === 'SUPER_ADMIN' || role === 'AUDITOR';
const audit = (req: any, action: string, id: string, after?: object) => basePrisma.auditLog.create({ data: { userId: req.user.id, userEmail: req.user.email, userRole: req.user.role, action, entity: 'Document', entityId: id, ip: req.ip, after: after as any } });

documentsRouter.get('/', requirePermission('document:read'), ah(async (req, res) => {
  const { skip, take, page, pageSize, q } = pageParams(req);
  const { type, entityType, entityId, supplierId } = req.query as Record<string, string | undefined>;
  const role = req.user!.role;
  const where: any = { ...(type && { type }), ...(entityType && { entityType }), ...(entityId && { entityId }), ...(supplierId && { supplierId }), ...(q && { OR: [{ title: { contains: q, mode: 'insensitive' } }, { fileName: { contains: q, mode: 'insensitive' } }] }), ...(!['SUPER_ADMIN', 'AUDITOR'].includes(role) && { OR: [{ allowedRoles: { isEmpty: true } }, { allowedRoles: { has: role } }] }) };
  const [rows, total] = await Promise.all([prisma.document.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, select: { id: true, title: true, type: true, fileName: true, mimeType: true, size: true, version: true, entityType: true, entityId: true, allowedRoles: true, createdAt: true } }), prisma.document.count({ where })]);
  res.json(paged(rows, total, page, pageSize));
}));
documentsRouter.post('/', requirePermission('document:create'), upload.array('files', 10), ah(async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) throw badRequest('No file attached');
  const b = z.object({ type: z.enum(['BMR', 'BPR', 'QC_REPORT', 'COA', 'SUPPLIER_INVOICE', 'GST_BILL', 'PRODUCTION_REPORT', 'PURCHASE_ORDER', 'GRN', 'SUPPLIER_DOCUMENT', 'OTHER']).default('OTHER'), entityType: opt(z.string()), entityId: opt(z.string()), supplierId: opt(z.string()), title: opt(z.string()), allowedRoles: z.string().optional() }).parse(req.body);
  const roles = b.allowedRoles ? b.allowedRoles.split(',').filter(Boolean) : [];
  const out = [];
  for (const f of files) {
    const s = await saveFile(f.buffer, f.originalname);
    out.push(await prisma.document.create({ data: { title: b.title ?? f.originalname, type: b.type, fileName: f.originalname, mimeType: f.mimetype, size: s.size, storagePath: s.storagePath, checksum: s.checksum, entityType: b.entityType, entityId: b.entityId, supplierId: b.supplierId, allowedRoles: roles as any, uploadedById: req.user!.id, versions: { create: { version: 1, fileName: f.originalname, storagePath: s.storagePath, size: s.size, uploadedById: req.user!.id } } } }));
  }
  res.status(201).json(out);
}));
documentsRouter.get('/:id', requirePermission('document:read'), ah(async (req, res) => {
  const d = await prisma.document.findUnique({ where: { id: req.params.id }, include: { versions: { orderBy: { version: 'desc' } } } });
  if (!d) throw notFound();
  if (!canSee(d, req.user!.role)) throw forbidden();
  const { storagePath, ...safe } = d;
  res.json(safe);
}));
documentsRouter.get('/:id/download', requirePermission('document:read'), ah(async (req, res) => {
  const d = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!d) throw notFound();
  if (!canSee(d, req.user!.role)) throw forbidden();
  const v = req.query.version ? await prisma.documentVersion.findUnique({ where: { documentId_version: { documentId: d.id, version: Number(req.query.version) } } }) : null;
  await audit(req, 'DOWNLOAD', d.id, { version: v?.version ?? d.version });
  res.type(d.mimeType).set('Content-Disposition', `${req.query.inline === 'true' ? 'inline' : 'attachment'}; filename="${(v?.fileName ?? d.fileName).replace(/"/g, '')}"`).send(await readStored(v?.storagePath ?? d.storagePath));
}));
documentsRouter.post('/:id/versions', requirePermission('document:create'), upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw badRequest('No file attached');
  const d = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!d) throw notFound();
  const s = await saveFile(req.file.buffer, req.file.originalname);
  const version = d.version + 1;
  res.status(201).json(await prisma.document.update({ where: { id: d.id }, data: { version, fileName: req.file.originalname, mimeType: req.file.mimetype, size: s.size, storagePath: s.storagePath, checksum: s.checksum, versions: { create: { version, fileName: req.file.originalname, storagePath: s.storagePath, size: s.size, uploadedById: req.user!.id } } } }));
}));
documentsRouter.patch('/:id', requirePermission('document:create'), ah(async (req, res) => {
  const b = z.object({ title: z.string().optional(), allowedRoles: z.array(z.string()).optional() }).parse(req.body);
  res.json(await prisma.document.update({ where: { id: req.params.id }, data: b as any }));
}));
documentsRouter.post('/:id/share', requirePermission('document:create'), ah(async (req, res) => {
  const { hours } = z.object({ hours: z.coerce.number().min(1).max(24 * 30).default(72) }).parse(req.body ?? {});
  const token = crypto.randomBytes(24).toString('base64url');
  await prisma.documentShare.create({ data: { documentId: req.params.id, token, expiresAt: new Date(Date.now() + hours * 3_600_000), createdById: req.user!.id } });
  res.status(201).json({ url: `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/public/share/${token}`, expiresInHours: hours });
}));
documentsRouter.delete('/:id', requirePermission('document:delete'), ah(async (req, res) => { await prisma.document.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }));

publicShareRouter.get('/share/:token', ah(async (req, res) => {
  const s = await basePrisma.documentShare.findUnique({ where: { token: req.params.token }, include: { document: true } });
  if (!s || s.expiresAt < new Date()) throw notFound('Link expired or invalid');
  await basePrisma.auditLog.create({ data: { action: 'SHARED_DOWNLOAD', entity: 'Document', entityId: s.documentId, ip: req.ip } });
  res.type(s.document.mimeType).set('Content-Disposition', `attachment; filename="${s.document.fileName.replace(/"/g, '')}"`).send(await readStored(s.document.storagePath));
}));
