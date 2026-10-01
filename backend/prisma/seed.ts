/* Demo data: runs the REAL business workflows (PO → GRN → QC → batch → release → dispatch) so ledgers,
   audit trail, signatures and dashboards are populated exactly as they would be in production. */
import bcrypt from 'bcryptjs';
import 'dotenv/config';
import { Role } from '@prisma/client';
import { runWithContext } from '../src/lib/context';
import { basePrisma as db, D, prisma } from '../src/lib/prisma';
import { transaction } from '../src/lib/prisma';
import { receiveLot } from '../src/services/inventory.service';
import { createFormula, submitFormula, approveFormula } from '../src/services/formula.service';
import * as B from '../src/services/batch.service';
import * as Q from '../src/services/qc.service';
import * as P from '../src/services/purchase.service';
import { runSweep } from '../src/services/expiry.service';

const PASSWORD = 'Pharma@12345';
type U = { id: string; email: string; role: Role };
const as = <T>(u: U, fn: () => Promise<T>) => runWithContext({ user: u }, fn);
const dayMs = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * dayMs);
const ahead = (d: number) => new Date(Date.now() + d * dayMs);

async function main() {
  if ((await db.user.count()) > 0) { console.log('Database already seeded — skipping.'); return; }
  const hash = await bcrypt.hash(PASSWORD, 12);

  await db.companyProfile.create({ data: { id: 'default', name: 'Meridian Life Sciences Pvt Ltd', address: 'Plot 44, MIDC Industrial Area, Pune, Maharashtra 411019', gstin: '27AABCM1234F1Z5', drugLicense: 'MH/MFG/2023/00417', phone: '+91 20 5550 1200', email: 'qa@meridianlife.example' } });

  const mk = (email: string, name: string, role: Role, code: string) => db.user.create({ data: { email, name, role, employeeCode: code, passwordHash: hash } });
  const [admin, prod, wh, qc, purch, store, auditor] = await Promise.all([
    mk('admin@pharma.local', 'Anita Deshmukh', 'SUPER_ADMIN', 'E001'), mk('production@pharma.local', 'Rohan Kulkarni', 'PRODUCTION_MANAGER', 'E002'),
    mk('warehouse@pharma.local', 'Sunil Patil', 'WAREHOUSE_MANAGER', 'E003'), mk('qc@pharma.local', 'Dr. Meera Iyer', 'QC_MANAGER', 'E004'),
    mk('purchase@pharma.local', 'Farhan Sheikh', 'PURCHASE_MANAGER', 'E005'), mk('store@pharma.local', 'Kavita More', 'STORE_OPERATOR', 'E006'),
    mk('auditor@pharma.local', 'Vikram Rao', 'AUDITOR', 'E007'),
  ]);
  const ops = await Promise.all(['Ganesh Jadhav', 'Pooja Nair', 'Imran Khan'].map((n, i) => mk(`operator${i + 1}@pharma.local`, n, 'STORE_OPERATOR', `E01${i}`)));
  const A: U = { id: admin.id, email: admin.email, role: admin.role }, PR: U = { id: prod.id, email: prod.email, role: prod.role }, QC: U = { id: qc.id, email: qc.email, role: qc.role },
    PU: U = { id: purch.id, email: purch.email, role: purch.role }, ST: U = { id: store.id, email: store.email, role: store.role };

  // ── Warehouses
  const rmStore = await db.warehouse.create({ data: { code: 'WH-RM', name: 'Raw Material Store', type: 'RAW_MATERIAL' } });
  const fgStore = await db.warehouse.create({ data: { code: 'WH-FG', name: 'Finished Goods Warehouse', type: 'FINISHED_GOODS' } });
  await db.warehouse.create({ data: { code: 'WH-CS', name: 'Cold Storage (2–8°C)', type: 'COLD_STORAGE' } });
  for (const wid of [rmStore.id, fgStore.id]) for (const r of ['R1', 'R2', 'R3']) {
    const rack = await db.rack.create({ data: { warehouseId: wid, code: r } });
    for (const l of ['A', 'B', 'C']) await db.bin.create({ data: { warehouseId: wid, rackId: rack.id, code: `${r}-${l}`, barcode: `BIN|${wid === rmStore.id ? 'RM' : 'FG'}|${r}-${l}` } });
  }
  const bin = await db.bin.findFirstOrThrow({ where: { warehouseId: rmStore.id, code: 'R1-A' } });
  await db.shift.createMany({ data: [{ name: 'Morning', startTime: '06:00', endTime: '14:00' }, { name: 'Evening', startTime: '14:00', endTime: '22:00' }, { name: 'Night', startTime: '22:00', endTime: '06:00' }] });

  // ── Suppliers
  const sup = async (code: string, name: string, gstin: string, terms: string) => db.supplier.create({ data: { code, name, gstin, isApproved: true, paymentTerms: terms, rating: D(4.2), email: `sales@${code.toLowerCase()}.example`, phone: '+91 98 0000 0000' } });
  const [s1, s2, s3, s4, s5] = await Promise.all([
    sup('SUP-0001', 'Gujarat Pharma Ingredients Pvt Ltd', '24AAACG1206D1ZM', 'Net 45'), sup('SUP-0002', 'Sun Chem Traders', '27AABCS9603R1ZM', 'Net 30'),
    sup('SUP-0003', 'Bangalore Excipients Ltd', '29AAGCB7383J1Z4', 'Net 45'), sup('SUP-0004', 'Chennai Packaging Solutions', '33AAACC8577K2ZO', 'Net 30'), sup('SUP-0005', 'Delhi Fine Chem', '07AAACD7409R1ZX', 'Advance'),
  ]);

  // ── Raw materials
  const rm = async (code: string, name: string, category: any, uom: string, min: number, reorder: number, price: number, shelf: number, sid: string, storage = 'Store below 30°C, dry place') =>
    db.rawMaterial.create({ data: { code, name, category, uom, minStock: min, reorderLevel: reorder, purchasePrice: price, shelfLifeMonths: shelf, storageCondition: storage, defaultSupplierId: sid, barcode: `MAT|${code}`, hsnCode: category === 'PACKAGING' ? '3923' : '2942', gstRate: 12 } });
  const para = await rm('RM-API-001', 'Paracetamol IP', 'API', 'KG', 100, 250, 210, 36, s1.id);
  const metf = await rm('RM-API-002', 'Metformin Hydrochloride IP', 'API', 'KG', 60, 150, 380, 36, s1.id);
  const ibu = await rm('RM-API-003', 'Ibuprofen IP', 'API', 'KG', 40, 100, 620, 36, s5.id);
  const starch = await rm('RM-EXC-001', 'Maize Starch IP', 'EXCIPIENT', 'KG', 150, 300, 42, 36, s3.id);
  const mcc = await rm('RM-EXC-002', 'Microcrystalline Cellulose PH102', 'EXCIPIENT', 'KG', 120, 250, 260, 36, s3.id);
  const pvp = await rm('RM-EXC-003', 'Povidone K30', 'EXCIPIENT', 'KG', 25, 70, 520, 36, s3.id);
  const mgst = await rm('RM-EXC-004', 'Magnesium Stearate IP', 'EXCIPIENT', 'KG', 15, 40, 310, 36, s2.id);
  const talc = await rm('RM-EXC-005', 'Purified Talc IP', 'EXCIPIENT', 'KG', 10, 30, 95, 36, s2.id);
  const coat = await rm('RM-COT-001', 'Opadry White Film Coat', 'COATING', 'KG', 25, 60, 1450, 24, s2.id);
  const foil = await rm('RM-PKG-001', 'Alu-Alu Blister Foil', 'PACKAGING', 'KG', 30, 80, 480, 24, s4.id);
  const carton = await rm('RM-PKG-002', 'Printed Mono Carton', 'PACKAGING', 'NOS', 3000, 8000, 3.4, 60, s4.id);

  // ── Products
  const pPara = await db.product.create({ data: { code: 'PCM500', name: 'Paracetamol Tablets IP', dosageForm: 'Tablet', strength: '500 mg', uom: 'TAB', packSize: '10 x 10', shelfLifeMonths: 36, sellingPrice: 1.1 } });
  const pMet = await db.product.create({ data: { code: 'MET500', name: 'Metformin Hydrochloride Tablets IP', dosageForm: 'Tablet', strength: '500 mg', uom: 'TAB', packSize: '10 x 10', shelfLifeMonths: 24, sellingPrice: 1.9 } });
  const pIbu = await db.product.create({ data: { code: 'IBU400', name: 'Ibuprofen Tablets IP', dosageForm: 'Tablet', strength: '400 mg', uom: 'TAB', packSize: '10 x 10', shelfLifeMonths: 24, sellingPrice: 1.6 } });

  // ── QC specifications
  await db.testSpecification.createMany({ data: [
    { rawMaterialId: para.id, testName: 'Description', textSpec: 'White crystalline powder' }, { rawMaterialId: para.id, testName: 'Assay', method: 'HPLC', lowerLimit: 99, upperLimit: 101, unit: '%' },
    { rawMaterialId: para.id, testName: 'Loss on drying', method: 'IP 2.4.19', upperLimit: 0.5, unit: '%' },
    { productId: pPara.id, testName: 'Assay', method: 'HPLC', lowerLimit: 95, upperLimit: 105, unit: '%' }, { productId: pPara.id, testName: 'Dissolution (45 min)', method: 'USP-2', lowerLimit: 80, unit: '%' },
    { productId: pPara.id, testName: 'Disintegration time', upperLimit: 15, unit: 'min' }, { productId: pPara.id, testName: 'Hardness', lowerLimit: 4, upperLimit: 8, unit: 'kg/cm²' },
  ] });

  // ── Formulas (author: production, approver: QC)
  const mkFormula = async (productId: string, items: { m: string; q: number; u: string; w?: number; stage?: string }[], instr: string) => {
    const f = await as(PR, () => createFormula({ productId, baseBatchSize: 100000, baseBatchUnit: 'TAB', expectedYieldPct: 98, instructions: instr, items: items.map((i) => ({ rawMaterialId: i.m, quantity: i.q, unit: i.u, wastagePct: i.w ?? 0, stage: i.stage })) }, prod.id));
    await as(PR, () => submitFormula(f.id, prod.id));
    return as(QC, () => approveFormula(f.id, qc.id, 'QC_MANAGER', 'Reviewed against registered dossier'));
  };
  await mkFormula(pPara.id, [
    { m: para.id, q: 50, u: 'KG', w: 1, stage: 'Granulation' }, { m: starch.id, q: 6, u: 'KG', stage: 'Granulation' }, { m: mcc.id, q: 8, u: 'KG', stage: 'Granulation' }, { m: pvp.id, q: 1.5, u: 'KG', stage: 'Granulation' },
    { m: mgst.id, q: 750, u: 'G', stage: 'Lubrication' }, { m: talc.id, q: 0.5, u: 'KG', stage: 'Lubrication' }, { m: coat.id, q: 2.4, u: 'KG', w: 5, stage: 'Coating' }, { m: foil.id, q: 12, u: 'KG', stage: 'Packaging' }, { m: carton.id, q: 1000, u: 'NOS', stage: 'Packaging' },
  ], '1) Sift API & excipients (#40). 2) Dry-mix 15 min in RMG. 3) Granulate with 10% PVP K30 paste; dry to LOD 1.5–2.5%. 4) Lubricate with Mg stearate & talc, 5 min. 5) Compress to 500 mg target weight 650 mg, hardness 4–8 kg. 6) Film-coat to 2–3% weight gain. 7) Blister pack 10x10 and carton.');
  await mkFormula(pMet.id, [{ m: metf.id, q: 50, u: 'KG', w: 1 }, { m: mcc.id, q: 9, u: 'KG' }, { m: pvp.id, q: 2, u: 'KG' }, { m: mgst.id, q: 1, u: 'KG' }, { m: coat.id, q: 2.5, u: 'KG', w: 5 }], 'Wet granulation, compress to 500 mg, film-coat.');
  await mkFormula(pIbu.id, [{ m: ibu.id, q: 40, u: 'KG', w: 1 }, { m: starch.id, q: 8, u: 'KG' }, { m: mcc.id, q: 6, u: 'KG' }, { m: mgst.id, q: 0.6, u: 'KG' }, { m: coat.id, q: 2, u: 'KG', w: 5 }], 'Direct compression with starch/MCC, film-coat.');

  // ── Opening stock (APPROVED lots, QC-certified) — deliberately mixed: healthy, low, near-expiry, expired, quarantined
  const lot = async (m: any, sid: string, no: string, qty: number, cost: number, expInDays: number, status: any = 'APPROVED', qcSample = false) =>
    as(A, () => transaction((tx) => receiveLot(tx, { rawMaterialId: m.id, lotNumber: no, supplierLot: `S-${no}`, supplierId: sid, warehouseId: rmStore.id, binId: bin.id, quantity: qty, unitCost: cost, mfgDate: ago(300), expiryDate: ahead(expInDays), status, reference: 'OPENING', userId: admin.id, createQcSample: qcSample })));
  await lot(para, s1.id, 'PCM-A2601', 420, 205, 700); await lot(para, s1.id, 'PCM-A2602', 320, 212, 820);
  await lot(metf, s1.id, 'MET-A2601', 180, 375, 640); await lot(ibu, s5.id, 'IBU-A2601', 120, 615, 560);
  await lot(starch, s3.id, 'STA-2601', 90, 41, 45); await lot(starch, s3.id, 'STA-2602', 220, 43, 500); // 45-day lot is FEFO-first → near-expiry alert
  await lot(mcc, s3.id, 'MCC-2601', 420, 258, 600); await lot(pvp, s3.id, 'PVP-2601', 70, 515, 480);
  await lot(pvp, s3.id, 'PVP-2602', 100, 528, 800, 'QUARANTINE', true); // awaiting QC
  await lot(mgst, s2.id, 'MGS-2601', 60, 305, 520); await lot(talc, s2.id, 'TAL-2501', 14, 92, -20, 'EXPIRED'); await lot(talc, s2.id, 'TAL-2601', 30, 96, 540);
  await lot(coat, s2.id, 'OPD-2601', 32, 1440, 300); // will fall below minimum after batches → low-stock alert
  await lot(foil, s4.id, 'FOL-2601', 160, 470, 380); await lot(carton, s4.id, 'CTN-2601', 40000, 3.3, 900);
  await db.$executeRawUnsafe(`UPDATE "StockMovement" SET "createdAt" = now() - (random()*150 || ' days')::interval WHERE type = 'RECEIPT'`);

  // ── Manufacture a history of batches through the full GMP workflow
  const fgBins = await db.bin.findMany({ where: { warehouseId: fgStore.id } });
  const plan: [any, number, number][] = [[pPara, 160, 98.1], [pPara, 143, 97.6], [pPara, 128, 98.4], [pMet, 112, 96.9], [pPara, 97, 97.9], [pIbu, 84, 98.2], [pPara, 70, 96.2], [pMet, 52, 98.0], [pPara, 35, 97.8], [pPara, 18, 98.3]];
  const released: string[] = [];
  for (const [i, [product, daysAgo, y]] of plan.entries()) {
    const mfg = ago(daysAgo);
    const b = await as(PR, () => B.createBatch({ productId: product.id, batchSize: 100000, mfgDate: mfg, operatorId: ops[i % 3].id }, prod.id));
    await as(A, () => B.approveBatch(b.id, admin.id, 'SUPER_ADMIN', 'Materials verified'));
    await as(PR, () => B.startProduction(b.id, prod.id));
    await as(PR, () => B.completeProduction(b.id, { actualYield: Math.round(100000 * (y / 100)), finishedGoodsWarehouseId: fgStore.id, binId: fgBins[i % fgBins.length].id }, prod.id));
    const sample = await db.qcSample.findFirstOrThrow({ where: { batchId: b.id } });
    await as(QC, () => Q.recordResults(sample.id, [
      { parameter: 'Assay', specification: '95.0 – 105.0 %', resultValue: (99 + (i % 3) * 0.4).toFixed(1), numericValue: 99 + (i % 3) * 0.4, lowerLimit: 95, upperLimit: 105, unit: '%' },
      { parameter: 'Dissolution (45 min)', specification: 'NLT 80 %', resultValue: String(92 + (i % 4)), numericValue: 92 + (i % 4), lowerLimit: 80, unit: '%' },
      { parameter: 'Hardness', specification: '4 – 8 kg/cm²', resultValue: (5.6 + (i % 3) * 0.3).toFixed(1), numericValue: 5.6 + (i % 3) * 0.3, lowerLimit: 4, upperLimit: 8, unit: 'kg/cm²' },
    ], qc.id));
    if (i < 8) { // leave the last two in QC review to populate pending queues
      await as(A, () => Q.finaliseSample(sample.id, admin.id, 'SUPER_ADMIN', 'Complies'));
      await as(QC, () => B.releaseBatch(b.id, qc.id, 'Released for distribution'));
      released.push(b.id);
    }
    await db.$executeRawUnsafe(`UPDATE "StockMovement" SET "createdAt" = $1 WHERE reference = $2 AND type IN ('CONSUMPTION','PRODUCTION_OUTPUT')`, mfg, b.batchNumber);
  }
  // Live pipeline: one approved, one draft, one in production
  const live = async (n: number, advance: ('approve' | 'start')[]) => {
    const b = await as(PR, () => B.createBatch({ productId: pPara.id, batchSize: n, mfgDate: new Date() }, prod.id));
    if (advance.includes('approve')) await as(A, () => B.approveBatch(b.id, admin.id, 'SUPER_ADMIN'));
    if (advance.includes('start')) await as(PR, () => B.startProduction(b.id, prod.id));
    return b;
  };
  await live(50000, []); await live(100000, ['approve']);
  await as(PR, () => live(50000, ['approve', 'start'])).catch((e) => console.log('  (live in-production batch skipped:', e.message, ')'));

  // ── Dispatch a released batch
  const fg = await db.finishedGoodLot.findFirstOrThrow({ where: { batchId: released[0] } });
  await db.$transaction(async (t) => {
    const d = await t.dispatch.create({ data: { dispatchNumber: `DSP-${new Date().getFullYear()}-00001`, customer: 'Apex Distributors, Mumbai', destination: 'Mumbai', invoiceRef: 'SI/26/0192', createdById: wh.id } });
    await t.finishedGoodLot.update({ where: { id: fg.id }, data: { availableQty: { decrement: 40000 } } });
    await t.dispatchItem.create({ data: { dispatchId: d.id, fgLotId: fg.id, quantity: 40000 } });
    await t.stockMovement.create({ data: { type: 'DISPATCH', fgLotId: fg.id, quantity: -40000, balanceAfter: fg.availableQty.sub(40000), reference: d.dispatchNumber, reason: 'To Apex Distributors', userId: wh.id } });
  });

  // ── Purchasing: PO → approve → partial GRN, then an invoice with a price mismatch
  const po = await as(PU, () => P.createPo({ supplierId: s1.id, expectedDate: ahead(7), items: [{ rawMaterialId: para.id, quantity: 300, unitPrice: 212, taxPct: 12 }, { rawMaterialId: metf.id, quantity: 100, unitPrice: 380, taxPct: 12 }] }, purch.id));
  await as(A, () => P.approvePo(po.id, admin.id, 'SUPER_ADMIN'));
  await as(ST, () => P.postGrn({ poId: po.id, warehouseId: rmStore.id, challanNo: 'CH-88121', vehicleNo: 'MH12 AB 4471', items: [{ rawMaterialId: para.id, lotNumber: 'PCM-A2609', supplierLot: 'GPI-77821', quantity: 300, unitCost: 212, mfgDate: ago(20), expiryDate: ahead(1000), binId: bin.id }] }, store.id));
  await as(PU, () => P.saveInvoice({ invoiceNumber: 'GPI/26-27/0412', invoiceDate: ago(3), supplierId: s1.id, gstin: '24AAACG1206D1ZM', poId: po.id, subtotal: 65100, taxTotal: 7812, total: 72912, items: [{ rawMaterialId: para.id, description: 'Paracetamol IP', quantity: 300, unit: 'KG', unitPrice: 217, taxPct: 12, amount: 65100 }] }, { source: 'MANUAL', userId: purch.id }));

  // ── Work orders
  const morning = await db.shift.findFirstOrThrow({ where: { name: 'Morning' } });
  for (const [n, p, q, s, e, st] of [[1, pPara, 100000, 1, 3, 'SCHEDULED'], [2, pMet, 100000, 4, 6, 'PLANNED'], [3, pIbu, 100000, 8, 10, 'PLANNED']] as const)
    await db.workOrder.create({ data: { woNumber: `WO-${new Date().getFullYear()}-0000${n}`, productId: p.id, quantity: q, plannedStart: ahead(s), plannedEnd: ahead(e), shiftId: morning.id, lineName: 'Tablet Line 1', status: st as any, operators: { create: [{ userId: ops[n % 3].id, task: 'Compression' }] } } });

  console.log('Running alert sweep…', await runSweep());
  console.log(`\nSeed complete. Sign in with any of these (password: ${PASSWORD}):\n  admin@pharma.local · production@ · warehouse@ · qc@ · purchase@ · store@ · auditor@   (…@pharma.local)`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
