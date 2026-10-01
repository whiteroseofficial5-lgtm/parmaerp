import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest } from '../lib/errors';
import { stockByMaterial } from './inventory.service';
import { expiryOverview } from './expiry.service';
import { supplierScores } from './ai/forecast';
import { tablePdf } from './pdf.service';

export interface Report { title: string; columns: { key: string; label: string }[]; rows: Record<string, any>[]; filters?: string }
interface Q { from?: string; to?: string; materialId?: string; productId?: string; entity?: string; userId?: string }

const d = (v?: Date | null) => (v ? v.toISOString().slice(0, 10) : '');
const range = (q: Q, field = 'createdAt') => (q.from || q.to ? { [field]: { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(new Date(q.to).getTime() + 86_399_000) : undefined } } : {});
const cols = (...c: [string, string][]) => c.map(([key, label]) => ({ key, label }));
const n = (v: any) => (v === null || v === undefined ? 0 : Number(v));

export const REPORTS: Record<string, (q: Q) => Promise<Report>> = {
  async inventory() {
    const [mats, stock] = await Promise.all([prisma.rawMaterial.findMany({ orderBy: { code: 'asc' } }), stockByMaterial()]);
    const val = await prisma.$queryRaw<{ rid: string; v: Prisma.Decimal }[]>`SELECT "rawMaterialId" AS rid, SUM("availableQty"*"unitCost") AS v FROM "MaterialLot" WHERE status IN ('APPROVED','QUARANTINE') GROUP BY 1`;
    const vm = new Map(val.map((x) => [x.rid, Number(x.v)]));
    return {
      title: 'Inventory Report', columns: cols(['code', 'Code'], ['name', 'Material'], ['category', 'Category'], ['uom', 'UOM'], ['usable', 'Usable'], ['quarantine', 'Quarantine'], ['min', 'Min'], ['reorder', 'Reorder'], ['value', 'Value (INR)']),
      rows: mats.map((m) => ({ code: m.code, name: m.name, category: m.category, uom: m.uom, usable: n(stock.get(m.id)?.usable ?? 0), quarantine: n(stock.get(m.id)?.quarantine ?? 0), min: n(m.minStock), reorder: n(m.reorderLevel), value: +(vm.get(m.id) ?? 0).toFixed(2) })),
    };
  },
  async 'stock-ledger'(q) {
    const rows = await prisma.stockMovement.findMany({
      where: { ...range(q), ...(q.materialId && { materialLot: { rawMaterialId: q.materialId } }) },
      include: { materialLot: { include: { rawMaterial: true } }, fgLot: { include: { product: true, batch: true } } }, orderBy: { createdAt: 'desc' }, take: 5000,
    });
    return {
      title: 'Stock Ledger', columns: cols(['date', 'Date/time'], ['type', 'Type'], ['item', 'Item'], ['lot', 'Lot / Batch'], ['qty', 'Qty (±)'], ['balance', 'Balance'], ['ref', 'Reference'], ['reason', 'Reason']),
      rows: rows.map((m) => ({ date: m.createdAt.toISOString().replace('T', ' ').slice(0, 16), type: m.type, item: m.materialLot?.rawMaterial.name ?? m.fgLot?.product.name, lot: m.materialLot?.lotNumber ?? m.fgLot?.batch.batchNumber, qty: n(m.quantity), balance: n(m.balanceAfter), ref: m.reference, reason: m.reason })),
    };
  },
  async consumption(q) {
    const rows = await prisma.stockMovement.findMany({ where: { type: 'CONSUMPTION', ...range(q) }, include: { materialLot: { include: { rawMaterial: true } } }, orderBy: { createdAt: 'desc' }, take: 5000 });
    return {
      title: 'Raw Material Consumption', columns: cols(['date', 'Date'], ['batch', 'Batch'], ['code', 'Code'], ['material', 'Material'], ['lot', 'Lot'], ['qty', 'Qty'], ['uom', 'UOM'], ['cost', 'Cost (INR)']),
      rows: rows.map((m) => ({ date: d(m.createdAt), batch: m.reference, code: m.materialLot!.rawMaterial.code, material: m.materialLot!.rawMaterial.name, lot: m.materialLot!.lotNumber, qty: Math.abs(n(m.quantity)), uom: m.materialLot!.rawMaterial.uom, cost: +(Math.abs(n(m.quantity)) * n(m.unitCost)).toFixed(2) })),
    };
  },
  async production(q) {
    const rows = await prisma.batch.findMany({ where: { ...range(q, 'mfgDate'), ...(q.productId && { productId: q.productId }) }, include: { product: true, operator: true }, orderBy: { mfgDate: 'desc' }, take: 5000 });
    return {
      title: 'Production Report', columns: cols(['batch', 'Batch'], ['product', 'Product'], ['mfg', 'Mfg date'], ['size', 'Batch size'], ['actual', 'Actual yield'], ['yield', 'Yield %'], ['status', 'Status'], ['qc', 'QC'], ['operator', 'Operator']),
      rows: rows.map((b) => ({ batch: b.batchNumber, product: b.product.name, mfg: d(b.mfgDate), size: n(b.batchSize), actual: b.actualYield === null ? '' : n(b.actualYield), yield: b.yieldPct === null ? '' : n(b.yieldPct), status: b.status, qc: b.qcStatus, operator: b.operator?.name })),
    };
  },
  async batches(q) { const r = await REPORTS.production(q); return { ...r, title: 'Batch Report' }; },
  async cost(q) {
    const rows = await prisma.batch.findMany({ where: { materialCost: { not: null }, ...range(q, 'mfgDate') }, include: { product: true }, orderBy: { mfgDate: 'desc' }, take: 5000 });
    return {
      title: 'Manufacturing Cost Report', columns: cols(['batch', 'Batch'], ['product', 'Product'], ['mfg', 'Mfg date'], ['output', 'Output'], ['cost', 'Material cost (INR)'], ['unit', 'Cost / unit'], ['yield', 'Yield %']),
      rows: rows.map((b) => ({ batch: b.batchNumber, product: b.product.name, mfg: d(b.mfgDate), output: n(b.actualYield), cost: n(b.materialCost), unit: n(b.costPerUnit), yield: n(b.yieldPct) })),
    };
  },
  async expiry() {
    const o = await expiryOverview(180);
    const rows = [
      ...o.rawMaterialExpired.map((l) => ({ kind: 'Raw material – EXPIRED', item: l.rawMaterial.name, lot: l.lotNumber, qty: n(l.availableQty), expiry: d(l.expiryDate), days: '' })),
      ...o.rawMaterialNearExpiry.map((l) => ({ kind: 'Raw material – near expiry', item: l.rawMaterial.name, lot: l.lotNumber, qty: n(l.availableQty), expiry: d(l.expiryDate), days: l.daysLeft })),
      ...o.finishedGoodsExpired.map((l) => ({ kind: 'Finished goods – EXPIRED', item: l.product.name, lot: l.batch.batchNumber, qty: n(l.availableQty), expiry: d(l.expiryDate), days: '' })),
      ...o.finishedGoodsNearExpiry.map((l) => ({ kind: 'Finished goods – near expiry', item: l.product.name, lot: l.batch.batchNumber, qty: n(l.availableQty), expiry: d(l.expiryDate), days: l.daysLeft })),
    ];
    return { title: 'Expiry Report (180-day horizon)', columns: cols(['kind', 'Category'], ['item', 'Item'], ['lot', 'Lot / Batch'], ['qty', 'Qty'], ['expiry', 'Expiry'], ['days', 'Days left']), rows };
  },
  async suppliers() {
    const s = await supplierScores();
    return { title: 'Supplier Performance Report', columns: cols(['name', 'Supplier'], ['score', 'Score'], ['grade', 'Grade'], ['onTimePct', 'On-time %'], ['fillRatePct', 'Fill rate %'], ['qualityPct', 'Quality %'], ['priceStabilityPct', 'Price stability %'], ['risk', 'Risk']), rows: s };
  },
  async audit(q) {
    const rows = await prisma.auditLog.findMany({ where: { ...range(q), ...(q.entity && { entity: q.entity }), ...(q.userId && { userId: q.userId }) }, orderBy: { createdAt: 'desc' }, take: 5000 });
    const short = (v: unknown) => (v ? JSON.stringify(v).slice(0, 300) : '');
    return {
      title: 'Audit Trail Report', columns: cols(['at', 'Date/time'], ['user', 'User'], ['role', 'Role'], ['action', 'Action'], ['entity', 'Entity'], ['entityId', 'Record'], ['before', 'Before'], ['after', 'After']),
      rows: rows.map((r) => ({ at: r.createdAt.toISOString().replace('T', ' ').slice(0, 19), user: r.userEmail, role: r.userRole, action: r.action, entity: r.entity, entityId: r.entityId, before: short(r.before), after: short(r.after) })),
    };
  },
};

export async function buildReport(name: string, q: Q): Promise<Report> {
  const fn = REPORTS[name];
  if (!fn) throw badRequest(`Unknown report "${name}". Available: ${Object.keys(REPORTS).join(', ')}`);
  const r = await fn(q);
  r.filters = [q.from && `From ${q.from}`, q.to && `To ${q.to}`].filter(Boolean).join('  ') || undefined;
  return r;
}

const csvCell = (v: any) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export async function exportReport(r: Report, format: 'csv' | 'xlsx' | 'pdf'): Promise<{ buffer: Buffer; mime: string; ext: string }> {
  if (format === 'csv') {
    const lines = [r.columns.map((c) => csvCell(c.label)).join(','), ...r.rows.map((row) => r.columns.map((c) => csvCell(row[c.key])).join(','))];
    return { buffer: Buffer.from('\uFEFF' + lines.join('\n')), mime: 'text/csv', ext: 'csv' };
  }
  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(r.title.slice(0, 30), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = r.columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 4) }));
    ws.addRows(r.rows);
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B4F9C' } };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: r.columns.length } };
    ws.columns.forEach((col) => { let max = 10; col.eachCell?.({ includeEmpty: false }, (c) => { max = Math.max(max, String(c.value ?? '').length + 2); }); col.width = Math.min(48, max); });
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' };
  }
  return { buffer: await tablePdf(r.title, r.columns, r.rows, r.filters), mime: 'application/pdf', ext: 'pdf' };
}
