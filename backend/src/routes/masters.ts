import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler';
import { notFound } from '../lib/errors';
import { pageParams, paged } from '../lib/pagination';
import { D, prisma } from '../lib/prisma';
import { qrPng } from '../lib/qr';
import { requirePermission } from '../middleware/auth';
import { stockByMaterial, stockState } from '../services/inventory.service';
import { crud } from './crud';

const num = z.coerce.number();
const opt = <T extends z.ZodTypeAny>(s: T) => s.optional().nullable().transform((v) => v ?? undefined);

// ───────── Raw materials ─────────
export const materialsRouter = Router();
const MatBody = z.object({
  code: z.string().min(2).max(40), name: z.string().min(2), category: z.enum(['API', 'EXCIPIENT', 'COATING', 'SOLVENT', 'PACKAGING', 'OTHER']),
  uom: z.string().min(1).max(10).transform((s) => s.toUpperCase()), minStock: num.min(0).default(0), reorderLevel: num.min(0).default(0), purchasePrice: num.min(0).default(0),
  shelfLifeMonths: opt(z.coerce.number().int().positive()), storageCondition: opt(z.string()), status: z.enum(['ACTIVE', 'INACTIVE', 'BLOCKED']).default('ACTIVE'),
  defaultSupplierId: opt(z.string()), hsnCode: opt(z.string()), gstRate: opt(num),
});

materialsRouter.get('/', requirePermission('material:read'), ah(async (req, res) => {
  const { skip, take, page, pageSize, q } = pageParams(req);
  const { category, status, state } = req.query as Record<string, string | undefined>;
  const where: any = { ...(category && { category }), ...(status && { status }), ...(q && { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }] }) };
  const stock = await stockByMaterial();
  const decorate = (m: any) => {
    const s = stock.get(m.id);
    const usable = s?.usable ?? D(0);
    return { ...m, usableStock: usable.toString(), quarantineStock: (s?.quarantine ?? D(0)).toString(), expiredStock: (s?.expired ?? D(0)).toString(), stockState: stockState(usable, m.minStock, m.reorderLevel) };
  };
  if (state) { // state is derived, so filter after decoration
    const all = (await prisma.rawMaterial.findMany({ where, include: { defaultSupplier: { select: { name: true } } }, orderBy: { code: 'asc' } })).map(decorate).filter((m) => m.stockState === state);
    return res.json(paged(all.slice(skip, skip + take), all.length, page, pageSize));
  }
  const [rows, total] = await Promise.all([prisma.rawMaterial.findMany({ where, skip, take, include: { defaultSupplier: { select: { name: true } } }, orderBy: { code: 'asc' } }), prisma.rawMaterial.count({ where })]);
  res.json(paged(rows.map(decorate), total, page, pageSize));
}));

materialsRouter.get('/:id', requirePermission('material:read'), ah(async (req, res) => {
  const m = await prisma.rawMaterial.findUnique({
    where: { id: req.params.id },
    include: { defaultSupplier: true, specs: true, lots: { orderBy: [{ expiryDate: 'asc' }], include: { warehouse: { select: { name: true } }, bin: { select: { code: true } }, coa: { select: { id: true, fileName: true } }, supplier: { select: { name: true } } } }, prices: { orderBy: { effectiveDate: 'desc' }, take: 20, include: { supplier: { select: { name: true } } } } },
  });
  if (!m) throw notFound();
  const s = (await stockByMaterial()).get(m.id);
  res.json({ ...m, usableStock: String(s?.usable ?? 0), quarantineStock: String(s?.quarantine ?? 0) });
}));

materialsRouter.post('/', requirePermission('material:create'), ah(async (req, res) => {
  const b = MatBody.parse(req.body);
  res.status(201).json(await prisma.rawMaterial.create({ data: { ...b, barcode: `MAT|${b.code}` } }));
}));
materialsRouter.patch('/:id', requirePermission('material:update'), ah(async (req, res) => res.json(await prisma.rawMaterial.update({ where: { id: req.params.id }, data: MatBody.partial().parse(req.body) }))));
materialsRouter.delete('/:id', requirePermission('material:delete'), ah(async (req, res) => { await prisma.rawMaterial.update({ where: { id: req.params.id }, data: { status: 'INACTIVE' } }); res.json({ ok: true }); }));

// ───────── Other masters ─────────
export const suppliersRouter = crud({
  model: 'supplier', perm: 'supplier', search: ['name', 'code', 'gstin'], filters: ['isApproved', 'isActive'], orderBy: { name: 'asc' },
  create: z.object({ code: z.string().min(2), name: z.string().min(2), gstin: opt(z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Invalid GSTIN')), contactName: opt(z.string()), email: opt(z.string().email()), phone: opt(z.string()), address: opt(z.string()), paymentTerms: opt(z.string()), isApproved: z.boolean().default(false), rating: opt(num), isActive: z.boolean().default(true) }),
});
suppliersRouter.get('/:id/performance', requirePermission('supplier:read'), ah(async (req, res) => {
  const [prices, pos, invoices, docs] = await Promise.all([
    prisma.supplierPrice.findMany({ where: { supplierId: req.params.id }, orderBy: { effectiveDate: 'desc' }, take: 100, include: { rawMaterial: { select: { name: true, code: true } } } }),
    prisma.purchaseOrder.findMany({ where: { supplierId: req.params.id }, orderBy: { orderDate: 'desc' }, take: 20, select: { id: true, poNumber: true, status: true, total: true, orderDate: true } }),
    prisma.supplierInvoice.findMany({ where: { supplierId: req.params.id }, orderBy: { invoiceDate: 'desc' }, take: 20, select: { id: true, invoiceNumber: true, total: true, status: true, invoiceDate: true } }),
    prisma.document.findMany({ where: { supplierId: req.params.id }, orderBy: { createdAt: 'desc' } }),
  ]);
  res.json({ priceHistory: prices, purchaseOrders: pos, invoices, documents: docs });
}));

export const productsRouter = crud({
  model: 'product', perm: 'bom', writePerm: 'production', search: ['name', 'code'], orderBy: { name: 'asc' },
  create: z.object({ code: z.string().min(2), name: z.string().min(2), dosageForm: opt(z.string()), strength: opt(z.string()), uom: z.string().default('TAB'), packSize: opt(z.string()), shelfLifeMonths: z.coerce.number().int().positive().default(24), sellingPrice: opt(num), isActive: z.boolean().default(true) }),
});

export const warehousesRouter = crud({
  model: 'warehouse', perm: 'warehouse', search: ['name', 'code'], include: { _count: { select: { bins: true, racks: true } } }, orderBy: { code: 'asc' },
  create: z.object({ code: z.string().min(2), name: z.string().min(2), type: z.string().default('GENERAL'), address: opt(z.string()), isActive: z.boolean().default(true) }),
});
export const racksRouter = crud({ model: 'rack', perm: 'warehouse', search: ['code'], filters: ['warehouseId'], orderBy: { code: 'asc' }, create: z.object({ warehouseId: z.string(), code: z.string().min(1), description: opt(z.string()) }) });
export const binsRouter = crud({ model: 'bin', perm: 'warehouse', search: ['code', 'barcode'], filters: ['warehouseId', 'rackId'], include: { rack: { select: { code: true } } }, orderBy: { code: 'asc' }, create: z.object({ warehouseId: z.string(), rackId: opt(z.string()), code: z.string().min(1), barcode: opt(z.string()), capacity: opt(num) }) });
export const specsRouter = crud({ model: 'testSpecification', perm: 'qc', search: ['testName'], filters: ['rawMaterialId', 'productId'], orderBy: { testName: 'asc' }, create: z.object({ rawMaterialId: opt(z.string()), productId: opt(z.string()), testName: z.string().min(2), method: opt(z.string()), lowerLimit: opt(num), upperLimit: opt(num), textSpec: opt(z.string()), unit: opt(z.string()) }) });
export const shiftsRouter = crud({ model: 'shift', perm: 'production', search: ['name'], orderBy: { name: 'asc' }, create: z.object({ name: z.string().min(2), startTime: z.string().regex(/^\d{2}:\d{2}$/), endTime: z.string().regex(/^\d{2}:\d{2}$/) }) });

// ───────── Barcode / QR scanner support ─────────
export const scanRouter = Router();
scanRouter.get('/resolve', requirePermission('stock:read'), ah(async (req, res) => {
  const code = String(req.query.code ?? '').trim();
  if (!code) return res.status(400).json({ error: 'code is required' });
  const [kind, a, b] = code.split('|');
  if (kind === 'LOT') {
    const lot = await prisma.materialLot.findFirst({ where: { OR: [{ barcode: code }, { rawMaterial: { code: a }, lotNumber: b }] }, include: { rawMaterial: true, warehouse: true, bin: true } });
    if (lot) return res.json({ type: 'LOT', data: lot });
  }
  const mat = await prisma.rawMaterial.findFirst({ where: { OR: [{ barcode: code }, { code }] } });
  if (mat) return res.json({ type: 'MATERIAL', data: mat });
  const bin = await prisma.bin.findFirst({ where: { barcode: code }, include: { warehouse: true, materialLots: { where: { availableQty: { gt: 0 } }, include: { rawMaterial: true } } } });
  if (bin) return res.json({ type: 'BIN', data: bin });
  const batchNo = decodeURIComponent(code.split('/trace/')[1] ?? code);
  const batch = await prisma.batch.findUnique({ where: { batchNumber: batchNo }, include: { product: true } });
  if (batch) return res.json({ type: 'BATCH', data: batch });
  res.status(404).json({ error: 'Code not recognised' });
}));

/** PNG QR label for a material, lot or bin (print & stick). */
scanRouter.get('/label', requirePermission('stock:read'), ah(async (req, res) => {
  const code = String(req.query.code ?? '');
  if (!code) return res.status(400).json({ error: 'code is required' });
  res.type('png').send(await qrPng(code, 300));
}));
