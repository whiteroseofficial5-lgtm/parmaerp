import { AiJobKind, BatchStatus, Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { bestMatch } from '../../lib/fuzzy';
import { D, prisma, transaction } from '../../lib/prisma';
import { convertQty } from '../../lib/uom';
import { readStored, saveFile } from '../../lib/storage';
import { sign } from '../../lib/signature';
import { allocateFefo, deductFromLot } from '../inventory.service';
import { saveInvoice, matchInvoice, InvoiceData } from '../purchase.service';
import { expiryFrom } from '../dates';
import { aiEnabled, extractWithClaude, ocrDocument, FileInput } from './provider';
import { BMR_SCHEMA, INVOICE_SCHEMA, BmrExtract, InvoiceExtract, overallConfidence } from './schemas';
import { heuristicBmr, heuristicInvoice } from './heuristics';
import { validateBmr, BmrLike } from './validation';

// ───────────── Upload & processing ─────────────

export async function createJob(kind: AiJobKind, file: { buffer: Buffer; mimetype: string; originalname: string }, userId: string) {
  const stored = await saveFile(file.buffer, file.originalname, kind === 'BMR' ? 'bmr' : 'invoices');
  const doc = await prisma.document.create({
    data: {
      title: file.originalname, type: kind === 'BMR' ? 'BMR' : 'SUPPLIER_INVOICE', fileName: file.originalname, mimeType: file.mimetype, size: stored.size,
      storagePath: stored.storagePath, checksum: stored.checksum, uploadedById: userId,
      versions: { create: { version: 1, fileName: file.originalname, storagePath: stored.storagePath, size: stored.size, uploadedById: userId } },
    },
  });
  const job = await prisma.aiJob.create({ data: { kind, documentId: doc.id, createdById: userId, status: 'UPLOADED' } });
  // Fire-and-forget so the upload request returns immediately; the UI polls the job.
  setImmediate(() => processJob(job.id).catch((e) => console.error('AI job failed', job.id, e)));
  return job;
}

async function extract<T>(file: FileInput, kind: AiJobKind): Promise<{ data: T; engine: string }> {
  if (aiEnabled()) {
    const isBmr = kind === 'BMR';
    return extractWithClaude<T>(file, {
      toolName: isBmr ? 'record_bmr' : 'record_invoice',
      description: isBmr ? 'Record the fields of a pharmaceutical Batch Manufacturing Record.' : 'Record the fields of a supplier / GST invoice.',
      schema: isBmr ? BMR_SCHEMA : INVOICE_SCHEMA,
      instruction: isBmr
        ? 'Extract this Batch Manufacturing Record. Include every ingredient row and every material consumption row (multi-page: read all pages). Handwritten entries are expected.'
        : 'Extract this supplier invoice / purchase bill (GST invoice possible). Include every line item across all pages, HSN codes, and the CGST/SGST/IGST split.',
    });
  }
  if (env.OCR_FALLBACK !== 'true') throw badRequest('AI extraction is not configured (set ANTHROPIC_API_KEY)');
  const text = await ocrDocument(file);
  return { data: (kind === 'BMR' ? heuristicBmr(text) : heuristicInvoice(text)) as unknown as T, engine: 'tesseract' };
}

export async function processJob(jobId: string) {
  const job = await prisma.aiJob.findUniqueOrThrow({ where: { id: jobId }, include: { document: true } });
  await prisma.aiJob.update({ where: { id: jobId }, data: { status: 'PROCESSING', error: null } });
  try {
    const buffer = await readStored(job.document.storagePath);
    const file: FileInput = { buffer, mimeType: job.document.mimeType, fileName: job.document.fileName };
    const { data, engine } = await extract<any>(file, job.kind);

    let corrected: any, validation: any;
    if (job.kind === 'BMR') {
      corrected = await resolveBmr(data as BmrExtract);
      validation = { engine, report: await validateBmr(toBmrLike(corrected), { narrative: false }) };
    } else {
      corrected = await resolveInvoice(data as InvoiceExtract);
      validation = { engine, match: corrected.supplierId ? await previewMatch(corrected) : null };
    }
    await prisma.aiJob.update({ where: { id: jobId }, data: { status: 'REVIEW', extracted: data as any, corrected, validation, confidence: D(overallConfidence(data.fieldConfidence)) } });
  } catch (e: any) {
    await prisma.aiJob.update({ where: { id: jobId }, data: { status: 'FAILED', error: e.message?.slice(0, 500) ?? 'Extraction failed' } });
  }
}

// ───────────── Resolvers (map extracted text → master data) ─────────────

async function resolveBmr(x: BmrExtract) {
  const products = await prisma.product.findMany();
  const p = (x.productCode && products.find((q) => q.code.toLowerCase() === x.productCode!.toLowerCase())) || (x.productName ? bestMatch(x.productName, products, (q) => [q.name, `${q.name} ${q.strength ?? ''}`, q.code])?.item : null);
  const mats = await prisma.rawMaterial.findMany();
  const users = await prisma.user.findMany({ where: { isActive: true } });
  const op = x.operatorName ? bestMatch(x.operatorName, users, (u) => [u.name], 0.7)?.item : null;
  const mapMat = <T extends { name: string }>(row: T) => ({ ...row, rawMaterialId: bestMatch(row.name, mats, (m) => [m.name, m.code], 0.7)?.item.id ?? null });
  return {
    ...x, productId: p?.id ?? null, operatorId: op?.id ?? null,
    ingredients: (x.ingredients ?? []).map(mapMat), materialConsumption: (x.materialConsumption ?? []).map(mapMat),
  };
}

const toBmrLike = (c: any): BmrLike => ({
  batchNumber: c.batchNumber, productName: c.productName, productCode: c.productCode, mfgDate: c.manufacturingDate, expiryDate: c.expiryDate,
  batchSize: c.batchSize?.value ?? null, batchUnit: c.batchSize?.unit ?? null, operator: c.operatorName, qcStatus: c.qcStatus, status: c.qcStatus === 'PASSED' ? 'RELEASED' : null,
  theoreticalYield: c.yield?.theoretical ?? null, actualYield: c.yield?.actual ?? null, yieldPct: c.yield?.percent ?? null,
  ingredients: (c.ingredients ?? []).map((i: any) => ({ name: i.name, quantity: i.quantity, unit: i.unit })),
  consumption: (c.materialConsumption ?? []).map((m: any) => ({ name: m.name, plannedQty: m.plannedQty, actualQty: m.actualQty, unit: m.unit, lotNumber: m.lotNumber })),
});

async function resolveInvoice(x: InvoiceExtract) {
  const sups = await prisma.supplier.findMany();
  const sup = (x.supplierGstin && sups.find((s) => s.gstin === x.supplierGstin)) || (x.supplierName ? bestMatch(x.supplierName, sups, (s) => [s.name], 0.7)?.item : null);
  const mats = await prisma.rawMaterial.findMany();
  return {
    ...x, supplierId: sup?.id ?? null, supplierMatched: !!sup, poId: null as string | null,
    items: (x.items ?? []).map((it) => {
      const m = bestMatch(it.description, mats, (r) => [r.name, r.code], 0.7);
      return { ...it, rawMaterialId: m?.item.id ?? null, matchScore: m ? +m.score.toFixed(2) : 0 };
    }),
  };
}

function toInvoiceData(c: any): InvoiceData {
  const items = (c.items ?? []).map((i: any) => ({ rawMaterialId: i.rawMaterialId, description: i.description, hsnCode: i.hsnCode ?? undefined, quantity: Number(i.quantity ?? 0), unit: i.unit ?? undefined, unitPrice: Number(i.unitPrice ?? 0), taxPct: Number(i.taxPct ?? 0), amount: Number(i.amount ?? 0) }));
  const subtotal = c.subtotal ?? items.reduce((s: number, i: any) => s + i.quantity * i.unitPrice, 0);
  const taxTotal = c.tax?.total ?? ((c.tax?.cgst ?? 0) + (c.tax?.sgst ?? 0) + (c.tax?.igst ?? 0));
  return { invoiceNumber: c.invoiceNumber, invoiceDate: new Date(c.invoiceDate), supplierId: c.supplierId, gstin: c.supplierGstin, poId: c.poId, subtotal: Number(subtotal), taxTotal: Number(taxTotal), total: Number(c.total ?? subtotal + taxTotal), items };
}
const previewMatch = (c: any) => (c.invoiceNumber && c.invoiceDate ? matchInvoice(toInvoiceData(c)) : null);

// ───────────── Review actions ─────────────

export async function saveCorrections(jobId: string, corrected: any, userId: string) {
  const job = await prisma.aiJob.findUnique({ where: { id: jobId } });
  if (!job) throw notFound('Job not found');
  if (!['REVIEW', 'FAILED'].includes(job.status)) throw conflict(`Job is ${job.status}`);
  const validation = job.kind === 'BMR'
    ? { ...(job.validation as any), report: await validateBmr(toBmrLike(corrected), { narrative: false }) }
    : { ...(job.validation as any), match: corrected.supplierId ? await previewMatch(corrected) : null };
  return prisma.aiJob.update({ where: { id: jobId }, data: { corrected, validation, status: 'REVIEW', reviewedById: userId } });
}

export async function rejectJob(jobId: string, userId: string) {
  return prisma.aiJob.update({ where: { id: jobId }, data: { status: 'REJECTED', reviewedById: userId } });
}

/** Commit a reviewed invoice: create supplier if new (unapproved), save invoice with matching, optionally receive stock. */
export async function commitInvoiceJob(jobId: string, userId: string, o: { warehouseId?: string; autoReceive?: boolean }) {
  const job = await prisma.aiJob.findUnique({ where: { id: jobId } });
  if (!job || job.kind !== 'INVOICE') throw notFound('Invoice job not found');
  if (job.status !== 'REVIEW') throw conflict(`Job is ${job.status}`);
  const c: any = job.corrected;
  if (!c?.invoiceNumber || !c?.invoiceDate) throw badRequest('Invoice number and date are required');
  if (!c.items?.length) throw badRequest('At least one line item is required');
  if (o.autoReceive && !o.warehouseId) throw badRequest('warehouseId is required to receive stock');

  if (!c.supplierId) {
    if (!c.supplierName) throw badRequest('Select or name the supplier');
    const count = await prisma.supplier.count();
    const s = await prisma.supplier.create({ data: { code: `SUP-${String(count + 1).padStart(4, '0')}`, name: c.supplierName, gstin: c.supplierGstin ?? undefined, isApproved: false } });
    c.supplierId = s.id;
  }
  const res = await saveInvoice(toInvoiceData(c), { documentId: job.documentId, source: 'AI_IMPORT', userId, autoReceive: o.autoReceive ? { warehouseId: o.warehouseId! } : undefined });
  await prisma.document.update({ where: { id: job.documentId }, data: { entityType: 'SupplierInvoice', entityId: res.invoice.id, supplierId: c.supplierId } });
  await prisma.aiJob.update({ where: { id: jobId }, data: { status: 'APPROVED', createdInvoiceId: res.invoice.id, reviewedById: userId, corrected: c } });
  return res;
}

/**
 * Commit a reviewed BMR as a Batch record.
 * Historic/paper batches were physically produced already, so by default NO stock is deducted (avoids double counting);
 * pass deductStock=true only when this is a live record whose materials are still on the books.
 */
export async function commitBmrJob(jobId: string, userId: string, o: { deductStock?: boolean; finishedGoodsWarehouseId?: string }) {
  const job = await prisma.aiJob.findUnique({ where: { id: jobId } });
  if (!job || job.kind !== 'BMR') throw notFound('BMR job not found');
  if (job.status !== 'REVIEW') throw conflict(`Job is ${job.status}`);
  const c: any = job.corrected;
  for (const k of ['batchNumber', 'productId', 'manufacturingDate', 'expiryDate']) if (!c?.[k]) throw badRequest(`"${k}" is required — correct it in the review screen`);
  if (!c.batchSize?.value) throw badRequest('Batch size is required');

  const batch = await transaction(async (tx) => {
    if (await tx.batch.findUnique({ where: { batchNumber: c.batchNumber } })) throw conflict(`Batch ${c.batchNumber} already exists`);
    const product = await tx.product.findUniqueOrThrow({ where: { id: c.productId } });
    const formula = (await tx.formula.findFirst({ where: { productId: c.productId, status: 'APPROVED' }, orderBy: { version: 'desc' } })) ?? (await tx.formula.findFirst({ where: { productId: c.productId }, orderBy: { version: 'desc' } }));
    if (!formula) throw badRequest('This product has no formula yet — create one before importing its batch records');

    const mfg = new Date(c.manufacturingDate), exp = new Date(c.expiryDate);
    const size = D(c.batchSize.value);
    const actual = c.yield?.actual != null ? D(c.yield.actual) : null;
    const theo = c.yield?.theoretical != null ? D(c.yield.theoretical) : size;
    const yieldPct = actual ? actual.div(theo).mul(100) : c.yield?.percent != null ? D(c.yield.percent) : null;
    const status: BatchStatus = c.qcStatus === 'PASSED' ? 'RELEASED' : c.qcStatus === 'FAILED' ? 'REJECTED' : 'QC_REVIEW';

    const consumed = (c.materialConsumption?.length ? c.materialConsumption : c.ingredients).filter((m: any) => m.rawMaterialId);
    const mats = await tx.rawMaterial.findMany({ where: { id: { in: consumed.map((m: any) => m.rawMaterialId) } } });
    const matMap = new Map(mats.map((m) => [m.id, m]));

    const b = await tx.batch.create({
      data: {
        batchNumber: c.batchNumber, productId: product.id, formulaId: formula.id, batchSize: size, batchUnit: c.batchSize.unit ?? formula.baseBatchUnit,
        mfgDate: mfg, expiryDate: exp ?? expiryFrom(mfg, product.shelfLifeMonths), status, qcStatus: c.qcStatus === 'PASSED' ? 'PASSED' : c.qcStatus === 'FAILED' ? 'FAILED' : 'PENDING',
        theoreticalYield: theo, actualYield: actual ?? undefined, yieldPct: yieldPct?.toDecimalPlaces(3), wastagePct: yieldPct ? Prisma.Decimal.max(D(100).sub(yieldPct), D(0)).toDecimalPlaces(3) : undefined,
        operatorId: c.operatorId ?? undefined, remarks: c.remarks ?? undefined, source: 'AI_IMPORT', bmrDocumentId: job.documentId, createdById: userId,
        completedAt: mfg, releasedAt: status === 'RELEASED' ? new Date() : undefined,
        history: { create: { toStatus: status, userId, remarks: `Imported from scanned BMR (AI job ${job.id}); stock ${o.deductStock ? 'deducted' : 'not adjusted'}` } },
      },
    });

    for (const m of consumed) {
      const mat = matMap.get(m.rawMaterialId)!;
      const qty = m.actualQty ?? m.quantity;
      if (qty == null) continue;
      let inStock: Prisma.Decimal;
      try { inStock = convertQty(qty, m.unit ?? mat.uom, mat.uom); } catch { throw badRequest(`Unit ${m.unit} is not convertible to ${mat.uom} for ${mat.name}`); }
      const bm = await tx.batchMaterial.upsert({
        where: { batchId_rawMaterialId: { batchId: b.id, rawMaterialId: mat.id } },
        create: { batchId: b.id, rawMaterialId: mat.id, unit: mat.uom, requiredQty: m.plannedQty != null ? convertQty(m.plannedQty, m.unit ?? mat.uom, mat.uom) : inStock, issuedQty: inStock },
        update: { issuedQty: inStock },
      });
      if (o.deductStock) {
        let cost = D(0);
        for (const a of await allocateFefo(tx, mat.id, inStock)) {
          await deductFromLot(tx, { lotId: a.lotId, quantity: a.quantity, type: 'CONSUMPTION', reference: b.batchNumber, reason: 'AI-imported BMR consumption', userId });
          await tx.batchMaterialConsumption.create({ data: { batchMaterialId: bm.id, materialLotId: a.lotId, quantity: a.quantity, unitCost: a.unitCost } });
          cost = cost.add(a.quantity.mul(a.unitCost));
        }
        await tx.batchMaterial.update({ where: { id: bm.id }, data: { unitCostAvg: inStock.gt(0) ? cost.div(inStock) : 0 } });
      }
    }
    if (actual && o.finishedGoodsWarehouseId && status !== 'REJECTED') {
      const fg = await tx.finishedGoodLot.create({ data: { batchId: b.id, productId: product.id, warehouseId: o.finishedGoodsWarehouseId, producedQty: actual, availableQty: actual, mfgDate: mfg, expiryDate: exp, status: status === 'RELEASED' ? 'RELEASED' : 'QUARANTINE' } });
      await tx.stockMovement.create({ data: { type: 'PRODUCTION_OUTPUT', fgLotId: fg.id, quantity: actual, balanceAfter: actual, toWarehouseId: o.finishedGoodsWarehouseId, reference: b.batchNumber, userId } });
    }
    await tx.document.update({ where: { id: job.documentId }, data: { entityType: 'Batch', entityId: b.id } });
    await sign(tx, userId, 'Batch', b.id, 'Data entered (AI import) by');
    await tx.aiJob.update({ where: { id: jobId }, data: { status: 'APPROVED', createdBatchId: b.id, reviewedById: userId } });
    return b;
  });
  return batch;
}
