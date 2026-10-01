import { Prisma, QcSampleType, Role } from '@prisma/client';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { D, prisma, transaction } from '../lib/prisma';
import { nextNumber } from '../lib/sequence';
import { notifyRoles } from '../lib/notify';
import { sign } from '../lib/signature';
import { qcReportPdf, storePdf } from './pdf.service';

export async function createSample(i: { type: QcSampleType; materialLotId?: string; batchId?: string; quantity?: number; remarks?: string }, userId: string) {
  if (i.type === 'RAW_MATERIAL' && !i.materialLotId) throw badRequest('materialLotId is required for raw material samples');
  if (i.type !== 'RAW_MATERIAL' && !i.batchId) throw badRequest('batchId is required for batch samples');
  return transaction(async (tx) => {
    const sampleNumber = await nextNumber(tx, 'QS');
    return tx.qcSample.create({ data: { sampleNumber, type: i.type, materialLotId: i.materialLotId, batchId: i.batchId, quantity: i.quantity, remarks: i.remarks, collectedById: userId } });
  });
}

/** Specifications the analyst should test against (raw-material or product specific). */
export async function specsForSample(sampleId: string) {
  const s = await prisma.qcSample.findUnique({ where: { id: sampleId }, include: { materialLot: true, batch: true } });
  if (!s) throw notFound('Sample not found');
  return prisma.testSpecification.findMany({
    where: s.materialLot ? { rawMaterialId: s.materialLot.rawMaterialId } : { productId: s.batch?.productId },
  });
}

export interface ResultInput {
  parameter: string; specification?: string; resultValue: string; numericValue?: number;
  lowerLimit?: number; upperLimit?: number; unit?: string; passed?: boolean;
}

/** Numeric results are auto-graded against limits; qualitative results need an explicit verdict. */
function grade(r: ResultInput): boolean {
  if (r.numericValue !== undefined && (r.lowerLimit !== undefined || r.upperLimit !== undefined)) {
    return (r.lowerLimit === undefined || r.numericValue >= r.lowerLimit) && (r.upperLimit === undefined || r.numericValue <= r.upperLimit);
  }
  if (r.passed === undefined) throw badRequest(`Result for "${r.parameter}" needs numeric limits or an explicit pass/fail`);
  return r.passed;
}

export async function recordResults(sampleId: string, results: ResultInput[], analystId: string) {
  if (!results.length) throw badRequest('No results supplied');
  return transaction(async (tx) => {
    const s = await tx.qcSample.findUnique({ where: { id: sampleId } });
    if (!s) throw notFound('Sample not found');
    if (['PASSED', 'FAILED'].includes(s.status)) throw conflict('Sample is already finalised');
    await tx.qcResult.deleteMany({ where: { sampleId } });
    await tx.qcResult.createMany({
      data: results.map((r) => ({
        sampleId, parameter: r.parameter, specification: r.specification, resultValue: r.resultValue,
        numericValue: r.numericValue !== undefined ? D(r.numericValue) : undefined,
        lowerLimit: r.lowerLimit !== undefined ? D(r.lowerLimit) : undefined, upperLimit: r.upperLimit !== undefined ? D(r.upperLimit) : undefined,
        unit: r.unit, passed: grade(r),
      })),
    });
    await sign(tx, analystId, 'QcSample', sampleId, 'Tested by');
    return tx.qcSample.update({ where: { id: sampleId }, data: { status: 'IN_TESTING', analystId }, include: { results: true } });
  });
}

/** QC manager's final review: finalise pass/fail and cascade to the lot or batch. */
export async function finaliseSample(sampleId: string, reviewerId: string, role: Role, remarks?: string) {
  const out = await transaction(async (tx) => {
    const s = await tx.qcSample.findUnique({ where: { id: sampleId }, include: { results: true, materialLot: { include: { rawMaterial: true } }, batch: true } });
    if (!s) throw notFound('Sample not found');
    if (['PASSED', 'FAILED'].includes(s.status)) throw conflict('Sample is already finalised');
    if (!s.results.length) throw badRequest('Record test results before finalising');
    if (s.analystId === reviewerId && role !== 'SUPER_ADMIN') throw forbidden('Segregation of duties: the analyst cannot review their own results');

    const passed = s.results.every((r) => r.passed);
    await tx.qcSample.update({ where: { id: sampleId }, data: { status: passed ? 'PASSED' : 'FAILED', reviewedById: reviewerId, completedAt: new Date(), remarks: remarks ?? s.remarks } });
    await sign(tx, reviewerId, 'QcSample', sampleId, passed ? 'QC Approved by' : 'QC Rejected by');

    if (s.materialLot) {
      await tx.materialLot.update({ where: { id: s.materialLot.id }, data: { status: passed ? 'APPROVED' : 'REJECTED' } });
    }
    if (s.batch) {
      const all = await tx.qcSample.findMany({ where: { batchId: s.batch.id } });
      const states = all.map((x) => (x.id === sampleId ? (passed ? 'PASSED' : 'FAILED') : x.status));
      const batchQc = states.includes('FAILED') ? 'FAILED' : states.every((x) => x === 'PASSED') ? 'PASSED' : 'IN_TESTING';
      await tx.batch.update({ where: { id: s.batch.id }, data: { qcStatus: batchQc } });
      if (batchQc === 'PASSED') {
        await notifyRoles(['QC_MANAGER'], { type: 'BATCH_RELEASE_PENDING', severity: 'WARNING', title: 'Batch ready for release', message: `Batch ${s.batch.batchNumber} passed all QC tests.`, link: `/batches/${s.batch.id}`, dedupeKey: `REL:${s.batch.id}` });
      }
    }
    const coa = await tx.coa.create({ data: { coaNumber: await nextNumber(tx, 'COA'), sampleId, issuedById: reviewerId } });
    return { sampleId, passed, coaId: coa.id, lotId: s.materialLot?.id, coaNumber: coa.coaNumber, sampleNumber: s.sampleNumber };
  });

  // Generate & file the COA PDF after commit (rendering must not hold the DB transaction open).
  const pdf = await qcReportPdf(sampleId, true);
  const doc = await storePdf(pdf, { title: `COA ${out.coaNumber}`, type: 'COA', entityType: 'QcSample', entityId: sampleId, userId: reviewerId, fileName: `${out.coaNumber}.pdf` });
  await prisma.coa.update({ where: { sampleId }, data: { documentId: doc.id } });
  if (out.lotId) await prisma.materialLot.updateMany({ where: { id: out.lotId, coaDocumentId: null }, data: { coaDocumentId: doc.id } });
  return { ...out, documentId: doc.id };
}
