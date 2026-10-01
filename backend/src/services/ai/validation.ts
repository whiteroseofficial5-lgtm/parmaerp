import { D, prisma } from '../../lib/prisma';
import { bestMatch } from '../../lib/fuzzy';
import { convertQty } from '../../lib/uom';
import { effectiveFormula } from '../formula.service';
import { expiryFrom } from '../dates';
import { aiEnabled, complete } from './provider';

export type Severity = 'INFO' | 'WARNING' | 'CRITICAL';
export interface Finding { severity: Severity; code: string; field?: string; message: string; expected?: any; actual?: any }
export interface ValidationReport { score: number; verdict: 'PASS' | 'REVIEW' | 'FAIL'; findings: Finding[]; narrative?: string; checkedAt: string }

/** Normalised BMR shape shared by AI-extracted data and DB batches. */
export interface BmrLike {
  batchNumber?: string | null; productName?: string | null; productCode?: string | null;
  mfgDate?: string | null; expiryDate?: string | null; batchSize?: number | null; batchUnit?: string | null;
  ingredients: { name: string; quantity: number | null; unit: string | null }[];
  consumption?: { name: string; plannedQty?: number | null; actualQty: number | null; unit: string | null; lotNumber?: string | null }[];
  operator?: string | null; qcStatus?: string | null; status?: string | null;
  theoreticalYield?: number | null; actualYield?: number | null; yieldPct?: number | null;
}

const TOL_WARN = 0.05, TOL_CRIT = 0.1;
const z = (x: number, arr: number[]) => { const m = arr.reduce((a, b) => a + b, 0) / arr.length; const s = Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length); return s ? (x - m) / s : 0; };

export async function validateBmr(b: BmrLike, opts: { excludeBatchNumber?: string; narrative?: boolean } = {}): Promise<ValidationReport> {
  const f: Finding[] = [];
  const add = (severity: Severity, code: string, message: string, field?: string, expected?: any, actual?: any) => f.push({ severity, code, message, field, expected, actual });

  // 1. Missing fields
  const req: [keyof BmrLike, string][] = [['batchNumber', 'Batch number'], ['productName', 'Product name'], ['mfgDate', 'Manufacturing date'], ['expiryDate', 'Expiry date'], ['batchSize', 'Batch size'], ['operator', 'Operator name'], ['qcStatus', 'QC status']];
  for (const [k, label] of req) if (b[k] === null || b[k] === undefined || b[k] === '' || b[k] === 'UNKNOWN') add(k === 'operator' ? 'WARNING' : 'CRITICAL', 'MISSING_FIELD', `${label} is missing or illegible.`, String(k));
  if (!b.ingredients?.length) add('CRITICAL', 'MISSING_FIELD', 'No ingredient list found.', 'ingredients');
  if (b.actualYield == null && b.yieldPct == null) add('WARNING', 'MISSING_FIELD', 'Yield information is missing.', 'yield');

  // 2. Dates & expiry
  const mfg = b.mfgDate ? new Date(b.mfgDate) : null, exp = b.expiryDate ? new Date(b.expiryDate) : null;
  if (mfg && mfg > new Date()) add('CRITICAL', 'FUTURE_MFG_DATE', 'Manufacturing date is in the future.', 'mfgDate', undefined, b.mfgDate);
  if (mfg && exp && exp <= mfg) add('CRITICAL', 'EXPIRY_BEFORE_MFG', 'Expiry date is not after manufacturing date.', 'expiryDate', undefined, b.expiryDate);

  // 3. Product & formula
  const product = await prisma.product.findFirst({ where: b.productCode ? { code: b.productCode } : undefined }).then(async (p) => {
    if (p) return p;
    if (!b.productName) return null;
    const all = await prisma.product.findMany();
    return bestMatch(b.productName, all, (x) => [x.name, `${x.name} ${x.strength ?? ''}`, x.code])?.item ?? null;
  });
  if (b.productName && !product) add('WARNING', 'UNKNOWN_PRODUCT', `Product "${b.productName}" is not in the product master.`, 'productName');
  if (product && mfg && exp) {
    const expected = expiryFrom(mfg, product.shelfLifeMonths);
    const off = Math.abs(exp.getTime() - expected.getTime()) / 86_400_000;
    if (off > 31) add('WARNING', 'SHELF_LIFE_MISMATCH', `Expiry differs from ${product.shelfLifeMonths}-month shelf life by ~${Math.round(off)} days.`, 'expiryDate', expected.toISOString().slice(0, 10), b.expiryDate);
  }
  const formula = product ? await effectiveFormula(product.id) : null;
  if (product && !formula) add('WARNING', 'NO_APPROVED_FORMULA', 'No approved formula on file to compare against.', 'formula');

  if (formula && b.batchSize && b.ingredients?.length) {
    const scale = b.batchSize / Number(formula.baseBatchSize);
    const seen = new Set<string>();
    for (const ing of b.ingredients) {
      const m = bestMatch(ing.name, formula.items, (i) => [i.rawMaterial.name, i.rawMaterial.code], 0.6);
      if (!m) { add('CRITICAL', 'EXTRA_INGREDIENT', `"${ing.name}" is not part of the approved formula.`, 'ingredients', undefined, ing.name); continue; }
      seen.add(m.item.rawMaterialId);
      if (ing.quantity == null || !ing.unit) { add('WARNING', 'MISSING_QTY', `Quantity/unit for ${ing.name} is missing.`, 'ingredients'); continue; }
      let exp: number;
      try { exp = Number(convertQty(m.item.quantity.mul(scale), m.item.unit, ing.unit)); } catch { add('WARNING', 'UNIT_MISMATCH', `${ing.name}: unit ${ing.unit} is incompatible with formula unit ${m.item.unit}.`, 'ingredients'); continue; }
      const dev = exp ? Math.abs(ing.quantity - exp) / exp : 0;
      if (dev > TOL_WARN) add(dev > TOL_CRIT ? 'CRITICAL' : 'WARNING', 'QTY_DEVIATION', `${ing.name}: ${ing.quantity} ${ing.unit} vs formula ${exp.toFixed(3)} ${ing.unit} (${(dev * 100).toFixed(1)} % off).`, 'ingredients', +exp.toFixed(3), ing.quantity);
    }
    for (const it of formula.items) if (!seen.has(it.rawMaterialId)) add('CRITICAL', 'MISSING_INGREDIENT', `Formula ingredient ${it.rawMaterial.name} is absent from the record.`, 'ingredients');
  }

  // 4. Consumption vs plan
  for (const c of b.consumption ?? []) {
    if (c.actualQty != null && c.actualQty <= 0) add('CRITICAL', 'NON_POSITIVE_QTY', `${c.name}: consumed quantity must be positive.`, 'consumption', undefined, c.actualQty);
    if (c.plannedQty && c.actualQty != null) {
      const dev = Math.abs(c.actualQty - c.plannedQty) / c.plannedQty;
      if (dev > TOL_WARN) add(dev > TOL_CRIT ? 'CRITICAL' : 'WARNING', 'CONSUMPTION_DEVIATION', `${c.name}: consumed ${c.actualQty} vs planned ${c.plannedQty} (${(dev * 100).toFixed(1)} %).`, 'consumption', c.plannedQty, c.actualQty);
    }
    if (c.lotNumber && mfg) {
      const lot = await prisma.materialLot.findFirst({ where: { lotNumber: c.lotNumber } });
      if (lot?.expiryDate && lot.expiryDate < mfg) add('CRITICAL', 'EXPIRED_MATERIAL_USED', `${c.name} lot ${c.lotNumber} had expired (${lot.expiryDate.toISOString().slice(0, 10)}) before manufacture.`, 'consumption');
      if (lot && ['REJECTED', 'QUARANTINE'].includes(lot.status)) add('CRITICAL', 'UNAPPROVED_LOT_USED', `Lot ${c.lotNumber} is ${lot.status}.`, 'consumption');
    }
  }

  // 5. Yield
  const th = b.theoreticalYield ?? b.batchSize ?? null;
  let yp = b.yieldPct ?? null;
  if (b.actualYield != null && th) {
    const calc = (b.actualYield / th) * 100;
    if (yp != null && Math.abs(calc - yp) > 1) add('WARNING', 'YIELD_CALC_MISMATCH', `Reported yield ${yp}% ≠ recalculated ${calc.toFixed(2)}%.`, 'yield', +calc.toFixed(2), yp);
    yp = calc;
    if (calc > 102) add('CRITICAL', 'YIELD_OVER_100', `Yield ${calc.toFixed(1)}% exceeds theoretical — check counts/calculation.`, 'yield');
  }
  if (yp != null && formula) {
    const exp = Number(formula.expectedYieldPct);
    if (yp < exp - 3) add(yp < exp - 8 ? 'CRITICAL' : 'WARNING', 'LOW_YIELD', `Yield ${yp.toFixed(1)}% is below expected ${exp}%.`, 'yield', exp, +yp.toFixed(2));
  }

  // 6. QC
  const released = ['RELEASED'].includes(b.status ?? '');
  if (b.qcStatus === 'FAILED' && released) add('CRITICAL', 'RELEASED_AFTER_QC_FAIL', 'Batch is marked released although QC FAILED.', 'qcStatus');
  if (b.qcStatus === 'PENDING' && released) add('CRITICAL', 'RELEASED_WITHOUT_QC', 'Batch released while QC is still pending.', 'qcStatus');
  if (b.qcStatus === 'FAILED') add('WARNING', 'QC_FAILED', 'QC status is FAILED — batch must not be released.', 'qcStatus');

  // 7. Statistical anomaly vs history of the same product
  if (product && yp != null) {
    const hist = await prisma.batch.findMany({ where: { productId: product.id, yieldPct: { not: null }, batchNumber: { not: opts.excludeBatchNumber ?? b.batchNumber ?? undefined } }, select: { yieldPct: true }, take: 50 });
    if (hist.length >= 5) {
      const zs = z(yp, hist.map((h) => Number(h.yieldPct)));
      if (Math.abs(zs) > 2.5) add('WARNING', 'YIELD_ANOMALY', `Yield ${yp.toFixed(1)}% is ${Math.abs(zs).toFixed(1)}σ from this product's history (n=${hist.length}).`, 'yield');
    }
  }

  const crit = f.filter((x) => x.severity === 'CRITICAL').length, warn = f.filter((x) => x.severity === 'WARNING').length;
  const score = Math.max(0, 100 - crit * 15 - warn * 5);
  const report: ValidationReport = { score, verdict: crit ? 'FAIL' : warn ? 'REVIEW' : 'PASS', findings: f, checkedAt: new Date().toISOString() };
  if (opts.narrative !== false && aiEnabled() && f.length) {
    try {
      report.narrative = await complete('You are a QA reviewer. Summarise BMR validation findings in 3 sentences: overall risk, the most serious issues, and what to fix first. No preamble.', JSON.stringify({ batch: b.batchNumber, product: b.productName, score, findings: f.slice(0, 25) }));
    } catch { /* narrative is optional */ }
  }
  return report;
}

/** Build the normalised shape from a DB batch so the same validator covers native and imported records. */
export async function bmrLikeFromDb(batchId: string): Promise<BmrLike | null> {
  const b = await prisma.batch.findUnique({ where: { id: batchId }, include: { product: true, operator: true, materials: { include: { rawMaterial: true, consumptions: { include: { materialLot: true } } } }, formula: { include: { items: { include: { rawMaterial: true } } } } } });
  if (!b) return null;
  const scale = D(b.batchSize).div(b.formula.baseBatchSize);
  return {
    batchNumber: b.batchNumber, productName: b.product.name, productCode: b.product.code, mfgDate: b.mfgDate.toISOString().slice(0, 10), expiryDate: b.expiryDate.toISOString().slice(0, 10),
    batchSize: Number(b.batchSize), batchUnit: b.batchUnit, operator: b.operator?.name ?? null, qcStatus: b.qcStatus === 'NOT_STARTED' ? null : b.qcStatus, status: b.status,
    theoreticalYield: b.theoreticalYield ? Number(b.theoreticalYield) : null, actualYield: b.actualYield ? Number(b.actualYield) : null, yieldPct: b.yieldPct ? Number(b.yieldPct) : null,
    ingredients: b.formula.items.map((i) => ({ name: i.rawMaterial.name, quantity: Number(i.quantity.mul(scale)), unit: i.unit })),
    consumption: b.materials.map((m) => ({ name: m.rawMaterial.name, plannedQty: Number(m.requiredQty), actualQty: Number(m.issuedQty), unit: m.unit, lotNumber: m.consumptions[0]?.materialLot.lotNumber })),
  };
}
