import fs from 'node:fs/promises';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { qrPng, traceUrl } from '../lib/qr';
import { saveFile } from '../lib/storage';
import { DocumentType } from '@prisma/client';

const BLUE = '#0B4F9C';
const LIGHT = '#EAF1FB';
const GREY = '#5B6776';

export const fmtDate = (d?: Date | string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
export const fmtDateTime = (d?: Date | string | null) =>
  d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
const num = (v: any, dp = 3) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: dp }));

interface Col { label: string; width: number; align?: 'left' | 'right' | 'center' }

class Pdf {
  doc: PDFKit.PDFDocument;
  constructor(private meta: { title: string; docNumber: string; company: { name: string; address?: string | null; gstin?: string | null; drugLicense?: string | null; logoPath?: string | null }; qrText?: string; qr?: Buffer; landscape?: boolean }) {
    this.doc = new PDFDocument({ size: 'A4', layout: meta.landscape ? 'landscape' : 'portrait', margins: { top: 40, bottom: 56, left: 40, right: 40 }, bufferPages: true, info: { Title: meta.title, Author: meta.company.name } });
  }
  get w() { return this.doc.page.width - this.doc.page.margins.left - this.doc.page.margins.right; }
  get left() { return this.doc.page.margins.left; }

  async header() {
    const { doc, meta } = this;
    let x = this.left;
    if (meta.company.logoPath) {
      try {
        const buf = await fs.readFile(path.resolve(env.UPLOAD_DIR, meta.company.logoPath));
        doc.image(buf, x, 36, { fit: [56, 56] });
        x += 66;
      } catch { /* logo optional */ }
    }
    doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(15).text(meta.company.name, x, 38, { width: this.w - 140 });
    doc.fillColor(GREY).font('Helvetica').fontSize(8)
      .text([meta.company.address, meta.company.gstin && `GSTIN ${meta.company.gstin}`, meta.company.drugLicense && `DL ${meta.company.drugLicense}`].filter(Boolean).join('  |  '), x, doc.y + 2, { width: this.w - 140 });
    if (meta.qr) doc.image(meta.qr, this.left + this.w - 76, 34, { width: 76 });
    doc.moveTo(this.left, 100).lineTo(this.left + this.w, 100).lineWidth(1.5).strokeColor(BLUE).stroke();
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(14).text(meta.title, this.left, 108, { width: this.w - 90 });
    doc.font('Helvetica').fontSize(9).fillColor(GREY).text(`Document No: ${meta.docNumber}    Generated: ${fmtDateTime(new Date())}`, this.left, doc.y + 2);
    doc.moveDown(0.8);
    doc.x = this.left;
  }

  h2(text: string) {
    this.ensure(40);
    const y = this.doc.y + 6;
    this.doc.rect(this.left, y, this.w, 18).fill(LIGHT);
    this.doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(10).text(text, this.left + 6, y + 5, { width: this.w - 12 });
    this.doc.y = y + 24;
    this.doc.x = this.left;
    this.doc.fillColor('#111');
  }

  kv(pairs: [string, any][], cols = 2) {
    const colW = this.w / cols;
    const rows = Math.ceil(pairs.length / cols);
    this.ensure(rows * 16 + 8);
    const startY = this.doc.y;
    pairs.forEach(([k, v], i) => {
      const cx = this.left + (i % cols) * colW;
      const cy = startY + Math.floor(i / cols) * 16;
      this.doc.font('Helvetica').fontSize(8).fillColor(GREY).text(k, cx, cy, { width: colW * 0.4, lineBreak: false });
      this.doc.font('Helvetica-Bold').fontSize(9).fillColor('#111').text(String(v ?? '—'), cx + colW * 0.4, cy - 1, { width: colW * 0.58, lineBreak: false, ellipsis: true });
    });
    this.doc.y = startY + rows * 16 + 6;
    this.doc.x = this.left;
  }

  ensure(h: number) {
    if (this.doc.y + h > this.doc.page.height - this.doc.page.margins.bottom) this.doc.addPage();
  }

  paragraph(text: string) {
    this.doc.font('Helvetica').fontSize(9).fillColor('#111').text(text || '—', this.left, this.doc.y, { width: this.w, align: 'left' });
    this.doc.moveDown(0.6);
  }

  table(cols: Col[], rows: (string | number | null | undefined)[][], opts: { zebra?: boolean } = {}) {
    const total = cols.reduce((s, c) => s + c.width, 0);
    const widths = cols.map((c) => (c.width / total) * this.w);
    const drawHeader = () => {
      const y = this.doc.y;
      this.doc.rect(this.left, y, this.w, 18).fill(BLUE);
      let x = this.left;
      cols.forEach((c, i) => {
        this.doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8).text(c.label, x + 4, y + 5, { width: widths[i] - 8, align: c.align ?? 'left', lineBreak: false });
        x += widths[i];
      });
      this.doc.y = y + 18;
    };
    drawHeader();
    rows.forEach((r, ri) => {
      this.doc.font('Helvetica').fontSize(8);
      const h = Math.max(...r.map((cell, i) => this.doc.heightOfString(String(cell ?? '—'), { width: widths[i] - 8 }))) + 8;
      if (this.doc.y + h > this.doc.page.height - this.doc.page.margins.bottom) { this.doc.addPage(); drawHeader(); }
      const y = this.doc.y;
      if ((opts.zebra ?? true) && ri % 2 === 1) this.doc.rect(this.left, y, this.w, h).fill('#F6F9FD');
      let x = this.left;
      r.forEach((cell, i) => {
        this.doc.fillColor('#111').font('Helvetica').fontSize(8).text(String(cell ?? '—'), x + 4, y + 4, { width: widths[i] - 8, align: cols[i].align ?? 'left' });
        x += widths[i];
      });
      this.doc.y = y + h;
    });
    this.doc.moveTo(this.left, this.doc.y).lineTo(this.left + this.w, this.doc.y).lineWidth(0.5).strokeColor('#C8D3E0').stroke();
    this.doc.moveDown(0.6);
    this.doc.x = this.left;
  }

  async signatures(entity: string, entityId: string) {
    const sigs = await prisma.signature.findMany({ where: { entity, entityId }, include: { user: { select: { name: true, role: true } } }, orderBy: { createdAt: 'asc' } });
    this.h2('Digital signatures & approval workflow');
    if (!sigs.length) return this.paragraph('No electronic signatures recorded yet.');
    this.table(
      [{ label: 'Meaning', width: 2 }, { label: 'Signed by', width: 2 }, { label: 'Role', width: 2 }, { label: 'Date / time', width: 2.2 }, { label: 'Signature ID', width: 2 }],
      sigs.map((s) => [s.meaning, s.user.name, s.user.role.replace(/_/g, ' '), fmtDateTime(s.createdAt), s.hash.slice(0, 16).toUpperCase()]),
    );
  }

  finish(): Promise<Buffer> {
    const { doc } = this;
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const prev = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7.5).fillColor(GREY)
        .text(`${this.meta.company.name} — ${this.meta.docNumber} — Computer generated document, valid with electronic signatures shown.`, this.left, doc.page.height - 34, { width: this.w - 70, lineBreak: false })
        .text(`Page ${i - range.start + 1} of ${range.count}`, this.left + this.w - 70, doc.page.height - 34, { width: 70, align: 'right', lineBreak: false });
      doc.page.margins.bottom = prev;
    }
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    });
  }
}

async function company() {
  const c = await prisma.companyProfile.findUnique({ where: { id: 'default' } });
  return c ?? { id: 'default', name: 'PharmaERP Laboratories', address: null, gstin: null, drugLicense: null, logoPath: null, phone: null, email: null };
}

// ───────────── Documents ─────────────

export async function bmrPdf(batchId: string) {
  const b = await prisma.batch.findUnique({
    where: { id: batchId },
    include: {
      product: true, formula: true, operator: true, history: { orderBy: { createdAt: 'asc' } }, fgLot: { include: { warehouse: true } },
      materials: { include: { rawMaterial: true, consumptions: { include: { materialLot: true } } } },
      qcSamples: { include: { results: true } },
    },
  });
  if (!b) throw notFound('Batch not found');
  const p = new Pdf({ title: 'Batch Manufacturing Record (BMR)', docNumber: `BMR/${b.batchNumber}`, company: await company(), qr: await qrPng(traceUrl(b.batchNumber), 160) });
  await p.header();
  p.h2('Product & batch details');
  p.kv([
    ['Product', `${b.product.name} ${b.product.strength ?? ''}`], ['Product code', b.product.code],
    ['Batch number', b.batchNumber], ['Formula version', `v${b.formula.version}`],
    ['Batch size', `${num(b.batchSize)} ${b.batchUnit}`], ['Status', b.status.replace(/_/g, ' ')],
    ['Mfg date', fmtDate(b.mfgDate)], ['Expiry date', fmtDate(b.expiryDate)],
    ['Operator', b.operator?.name ?? '—'], ['QC status', b.qcStatus.replace(/_/g, ' ')],
    ['Started', fmtDateTime(b.startedAt)], ['Completed', fmtDateTime(b.completedAt)],
  ]);
  p.h2('Raw material issue & consumption');
  p.table(
    [{ label: 'Code', width: 1.4 }, { label: 'Material', width: 3 }, { label: 'Required', width: 1.5, align: 'right' }, { label: 'Issued', width: 1.5, align: 'right' }, { label: 'Unit', width: 0.8 }, { label: 'Lots consumed (lot: qty)', width: 4 }],
    b.materials.map((m) => [m.rawMaterial.code, m.rawMaterial.name, num(m.requiredQty), num(m.issuedQty), m.unit, m.consumptions.map((c) => `${c.materialLot.lotNumber}: ${num(c.quantity)}`).join('; ') || '—']),
  );
  p.h2('Manufacturing instructions');
  p.paragraph(b.formula.instructions ?? 'Per approved master formula.');
  p.h2('Yield reconciliation');
  p.kv([
    ['Theoretical yield', `${num(b.theoreticalYield)} ${b.batchUnit}`], ['Actual yield', b.actualYield ? `${num(b.actualYield)} ${b.batchUnit}` : '—'],
    ['Yield %', b.yieldPct ? `${num(b.yieldPct, 2)} %` : '—'], ['Wastage %', b.wastagePct ? `${num(b.wastagePct, 2)} %` : '—'],
    ['Material cost', b.materialCost ? `INR ${num(b.materialCost, 2)}` : '—'], ['Cost / unit', b.costPerUnit ? `INR ${num(b.costPerUnit, 4)}` : '—'],
  ]);
  if (b.qcSamples.length) {
    p.h2('Quality control results');
    p.table(
      [{ label: 'Sample', width: 2 }, { label: 'Parameter', width: 3 }, { label: 'Specification', width: 3 }, { label: 'Result', width: 2 }, { label: 'Verdict', width: 1.2 }],
      b.qcSamples.flatMap((s) => s.results.map((r) => [s.sampleNumber, r.parameter, r.specification ?? '—', `${r.resultValue} ${r.unit ?? ''}`, r.passed ? 'PASS' : 'FAIL'])),
    );
  }
  p.h2('Status history');
  p.table([{ label: 'From', width: 2 }, { label: 'To', width: 2 }, { label: 'Date / time', width: 2.5 }, { label: 'Remarks', width: 4 }], b.history.map((h) => [h.fromStatus ?? '—', h.toStatus, fmtDateTime(h.createdAt), h.remarks ?? '']));
  await p.signatures('Batch', b.id);
  return p.finish();
}

export async function bprPdf(batchId: string) {
  const b = await prisma.batch.findUnique({ where: { id: batchId }, include: { product: true, materials: { include: { rawMaterial: true } }, fgLot: true } });
  if (!b) throw notFound('Batch not found');
  const p = new Pdf({ title: 'Batch Packaging Record (BPR)', docNumber: `BPR/${b.batchNumber}`, company: await company(), qr: await qrPng(traceUrl(b.batchNumber), 160) });
  await p.header();
  p.h2('Batch details');
  p.kv([['Product', `${b.product.name} ${b.product.strength ?? ''}`], ['Batch number', b.batchNumber], ['Pack size', b.product.packSize ?? '—'], ['Mfg / Expiry', `${fmtDate(b.mfgDate)} / ${fmtDate(b.expiryDate)}`], ['Bulk quantity', b.fgLot ? `${num(b.fgLot.producedQty)} ${b.batchUnit}` : '—']]);
  p.h2('Packaging materials issued');
  const pk = b.materials.filter((m) => m.rawMaterial.category === 'PACKAGING');
  p.table([{ label: 'Code', width: 1.5 }, { label: 'Material', width: 4 }, { label: 'Issued', width: 1.5, align: 'right' }, { label: 'Used', width: 1.5 }, { label: 'Returned', width: 1.5 }, { label: 'Destroyed', width: 1.5 }], pk.length ? pk.map((m) => [m.rawMaterial.code, m.rawMaterial.name, num(m.issuedQty), '', '', '']) : [['—', 'No packaging materials on the formula', '', '', '', '']]);
  p.h2('Line clearance & in-process checks');
  p.table([{ label: 'Check', width: 5 }, { label: 'Yes / No', width: 1.5 }, { label: 'Checked by / Date', width: 2.5 }], ['Previous product & labels removed from line', 'Batch number, Mfg & Exp printed correctly', 'Seal / leak test satisfactory', 'Labels reconciled (issued = used + returned + destroyed)'].map((c) => [c, '', '']));
  p.h2('Quantity reconciliation');
  p.table([{ label: 'Item', width: 4 }, { label: 'Quantity', width: 2 }], ['Bulk received', 'Packed (good)', 'Rejects', 'QC samples', 'Balance returned', 'Total (must equal bulk received)'].map((c) => [c, '']));
  await p.signatures('Batch', b.id);
  return p.finish();
}

export async function poPdf(poId: string) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: poId }, include: { supplier: true, items: { include: { rawMaterial: true } } } });
  if (!po) throw notFound('Purchase order not found');
  const p = new Pdf({ title: 'Purchase Order', docNumber: po.poNumber, company: await company() });
  await p.header();
  p.h2('Supplier & order');
  p.kv([['Supplier', po.supplier.name], ['GSTIN', po.supplier.gstin], ['PO date', fmtDate(po.orderDate)], ['Expected delivery', fmtDate(po.expectedDate)], ['Status', po.status], ['Payment terms', po.supplier.paymentTerms]]);
  p.h2('Items');
  p.table(
    [{ label: '#', width: 0.6 }, { label: 'Code', width: 1.5 }, { label: 'Material', width: 4 }, { label: 'Qty', width: 1.3, align: 'right' }, { label: 'Unit', width: 0.8 }, { label: 'Rate', width: 1.3, align: 'right' }, { label: 'GST %', width: 1, align: 'right' }, { label: 'Amount', width: 1.6, align: 'right' }],
    po.items.map((i, n) => [n + 1, i.rawMaterial.code, i.rawMaterial.name, num(i.quantity), i.rawMaterial.uom, num(i.unitPrice, 2), num(i.taxPct, 1), num(i.quantity.mul(i.unitPrice), 2)]),
  );
  p.kv([['Subtotal', `INR ${num(po.subtotal, 2)}`], ['GST', `INR ${num(po.taxTotal, 2)}`], ['Total', `INR ${num(po.total, 2)}`]], 3);
  if (po.terms) { p.h2('Terms & conditions'); p.paragraph(po.terms); }
  await p.signatures('PurchaseOrder', po.id);
  return p.finish();
}

export async function grnPdf(grnId: string) {
  const g = await prisma.grn.findUnique({ where: { id: grnId }, include: { supplier: true, po: true, items: { include: { rawMaterial: true } } } });
  if (!g) throw notFound('GRN not found');
  const p = new Pdf({ title: 'Goods Receipt Note (GRN)', docNumber: g.grnNumber, company: await company() });
  await p.header();
  p.kv([['Supplier', g.supplier.name], ['PO reference', g.po?.poNumber], ['Received on', fmtDateTime(g.receivedAt)], ['Challan / Vehicle', `${g.challanNo ?? '—'} / ${g.vehicleNo ?? '—'}`]]);
  p.h2('Received items (all lots enter QUARANTINE until QC approval)');
  p.table(
    [{ label: 'Material', width: 3.5 }, { label: 'Lot', width: 2 }, { label: 'Received', width: 1.4, align: 'right' }, { label: 'Rejected', width: 1.3, align: 'right' }, { label: 'Mfg', width: 1.6 }, { label: 'Expiry', width: 1.6 }, { label: 'Rate', width: 1.2, align: 'right' }],
    g.items.map((i) => [`${i.rawMaterial.code} ${i.rawMaterial.name}`, i.lotNumber, num(i.quantity), num(i.rejectedQty), fmtDate(i.mfgDate), fmtDate(i.expiryDate), num(i.unitCost, 2)]),
  );
  await p.signatures('Grn', g.id);
  return p.finish();
}

export async function qcReportPdf(sampleId: string, asCoa = false) {
  const s = await prisma.qcSample.findUnique({
    where: { id: sampleId },
    include: { results: true, coa: true, materialLot: { include: { rawMaterial: true, supplier: true } }, batch: { include: { product: true } } },
  });
  if (!s) throw notFound('QC sample not found');
  const subject = s.materialLot ? `${s.materialLot.rawMaterial.name} — Lot ${s.materialLot.lotNumber}` : `${s.batch?.product.name} — Batch ${s.batch?.batchNumber}`;
  const p = new Pdf({
    title: asCoa ? 'Certificate of Analysis' : 'QC Test Report', docNumber: asCoa && s.coa ? s.coa.coaNumber : s.sampleNumber, company: await company(),
    qr: s.batch ? await qrPng(traceUrl(s.batch.batchNumber), 160) : undefined,
  });
  await p.header();
  p.kv([['Sample no.', s.sampleNumber], ['Type', s.type.replace(/_/g, ' ')], ['Subject', subject], ['Collected', fmtDateTime(s.collectedAt)], ['Completed', fmtDateTime(s.completedAt)], ['Overall result', s.status]]);
  p.h2('Test results');
  p.table(
    [{ label: 'Parameter', width: 3 }, { label: 'Specification', width: 3 }, { label: 'Result', width: 2 }, { label: 'Unit', width: 1 }, { label: 'Verdict', width: 1.2 }],
    s.results.map((r) => [r.parameter, r.specification ?? `${r.lowerLimit ?? ''} – ${r.upperLimit ?? ''}`, r.resultValue, r.unit ?? '', r.passed ? 'COMPLIES' : 'DOES NOT COMPLY']),
  );
  if (s.remarks) { p.h2('Remarks'); p.paragraph(s.remarks); }
  await p.signatures('QcSample', s.id);
  return p.finish();
}

/** Generic tabular PDF used by the reporting engine (inventory, audit, production …). */
export async function tablePdf(title: string, columns: { key: string; label: string }[], rows: Record<string, any>[], filters?: string) {
  const p = new Pdf({ title, docNumber: `RPT/${new Date().toISOString().slice(0, 10)}`, company: await company(), landscape: columns.length > 6 });
  await p.header();
  if (filters) p.paragraph(filters);
  p.table(columns.map((c) => ({ label: c.label, width: 1 })), rows.map((r) => columns.map((c) => fmtCell(r[c.key]))));
  return p.finish();
}

const fmtCell = (v: any) => (v instanceof Date ? fmtDate(v) : v && typeof v === 'object' && 'toFixed' in v ? num(v) : v ?? '');

export async function validationPdf(title: string, subject: string, report: { score: number; verdict: string; findings: any[]; narrative?: string }) {
  const p = new Pdf({ title, docNumber: `VAL/${new Date().toISOString().slice(0, 10)}`, company: await company() });
  await p.header();
  p.kv([['Subject', subject], ['Score', `${report.score} / 100`], ['Verdict', report.verdict]]);
  if (report.narrative) { p.h2('Summary'); p.paragraph(report.narrative); }
  p.h2('Findings');
  p.table([{ label: 'Severity', width: 1.3 }, { label: 'Code', width: 2 }, { label: 'Field', width: 1.6 }, { label: 'Finding', width: 5 }], report.findings.map((f) => [f.severity, f.code, f.field ?? '', f.message]));
  return p.finish();
}

/** Persist a generated PDF into the Document Management System. */
export async function storePdf(buf: Buffer, o: { title: string; type: DocumentType; entityType: string; entityId: string; userId?: string; fileName: string }) {
  const f = await saveFile(buf, o.fileName, 'generated');
  return prisma.document.create({
    data: { title: o.title, type: o.type, fileName: o.fileName, mimeType: 'application/pdf', size: f.size, storagePath: f.storagePath, checksum: f.checksum, entityType: o.entityType, entityId: o.entityId, uploadedById: o.userId, versions: { create: { version: 1, fileName: o.fileName, storagePath: f.storagePath, size: f.size, uploadedById: o.userId } } },
  });
}
