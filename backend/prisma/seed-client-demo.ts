/**
 * Client demo seed — adds the client's OWN two products (from their paper batch records)
 * as real master data: raw materials, products, and an APPROVED formula/BOM for each.
 *
 * Run AFTER the main seed (needs admin/production/qc users to exist):
 *   npm run seed:client-demo
 *
 * This uses the same service functions as the app itself (createFormula → submitFormula →
 * approveFormula), so the result carries a full audit trail and electronic signatures,
 * exactly as if a real user had entered it through the UI.
 *
 * Source: client-provided handwritten batch dispensing sheets for "Multimax Tab" and
 * "Healing OK". Tick marks on the paper are read as dispensing sign-off checks (both
 * ingredients are included in the formula) rather than removed ingredients.
 */
import 'dotenv/config';
import { MaterialCategory } from '@prisma/client';
import { runWithContext } from '../src/lib/context';
import { basePrisma as db, D } from '../src/lib/prisma';
import { approveFormula, createFormula, submitFormula } from '../src/services/formula.service';

const as = <T>(user: { id: string; email: string; role: any }, fn: () => Promise<T>) => runWithContext({ user }, fn);

const slug = (s: string) =>
  'RM-' + s.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);

interface Ing { name: string; qty: number; unit: string; category: MaterialCategory; stockUom?: string }

async function ensureMaterial(i: Ing) {
  const code = slug(i.name);
  const existing = await db.rawMaterial.findUnique({ where: { code } });
  if (existing) return existing;
  return db.rawMaterial.create({
    data: {
      code,
      name: i.name,
      category: i.category,
      uom: i.stockUom ?? 'KG',
      minStock: 0,
      reorderLevel: 0,
      purchasePrice: 0,
      shelfLifeMonths: 24,
      barcode: `MAT|${code}`,
    },
  });
}

async function main() {
  const [admin, production, qc] = await Promise.all([
    db.user.findUnique({ where: { email: 'admin@pharma.local' } }),
    db.user.findUnique({ where: { email: 'production@pharma.local' } }),
    db.user.findUnique({ where: { email: 'qc@pharma.local' } }),
  ]);
  if (!admin || !production || !qc) {
    console.error('Run the main seed first (npm run seed) — demo users not found.');
    process.exit(1);
  }
  const A = { id: admin.id, email: admin.email, role: admin.role };
  const PR = { id: production.id, email: production.email, role: production.role };
  const QC = { id: qc.id, email: qc.email, role: qc.role };

  // ───────── Multimax Tab ─────────
  const multimaxIngredients: Ing[] = [
    { name: 'Vitamin B1', qty: 588, unit: 'G', category: 'API' },
    { name: 'Vitamin B2', qty: 632, unit: 'G', category: 'API' },
    { name: 'Vitamin B3', qty: 7.56, unit: 'KG', category: 'API' },
    { name: 'Vitamin B5', qty: 1.26, unit: 'KG', category: 'API' },
    { name: 'Vitamin B6', qty: 420, unit: 'G', category: 'API' },
    { name: 'Folic Acid', qty: 44, unit: 'G', category: 'API' },
    { name: 'Iodine', qty: 180, unit: 'G', category: 'API' },
    { name: 'Copper Sulphate', qty: 32, unit: 'G', category: 'API' },
    { name: 'Selenium Dioxide', qty: 20, unit: 'G', category: 'API' },
    { name: 'Chromium Sulphate', qty: 40, unit: 'G', category: 'API' },
    { name: 'SMP', qty: 50, unit: 'G', category: 'EXCIPIENT' },
    { name: 'SPP', qty: 26, unit: 'G', category: 'EXCIPIENT' },
    { name: 'Sodium Metabisulphate', qty: 32, unit: 'G', category: 'EXCIPIENT' },
    { name: 'Di Sodium EDTA', qty: 32, unit: 'G', category: 'EXCIPIENT' },
    { name: 'PVP K30', qty: 100, unit: 'G', category: 'EXCIPIENT' },
    { name: 'Grape Seed Extract', qty: 8, unit: 'KG', category: 'API' },
    { name: 'Vitamin A', qty: 252, unit: 'G', category: 'API' },
    { name: 'Vitamin B12', qty: 420, unit: 'MG', category: 'API' },
    { name: 'Vitamin C', qty: 8.4, unit: 'KG', category: 'API' },
    { name: 'Vitamin E', qty: 8, unit: 'KG', category: 'API' },
    { name: 'Zinc Sulphate', qty: 7, unit: 'KG', category: 'API' },
    { name: 'Ginseng Extract', qty: 10, unit: 'G', category: 'API' },
    { name: 'Green Tea Extract', qty: 200, unit: 'G', category: 'API' },
    { name: 'Magnesium Sulphate', qty: 6, unit: 'KG', category: 'API' },
    { name: 'Biotin', qty: 64, unit: 'G', category: 'API' },
    { name: 'Vitamin D3', qty: 2, unit: 'G', category: 'API' },
    { name: 'Magnesium Stearate', qty: 2.8, unit: 'KG', category: 'EXCIPIENT' },
    { name: 'Talcum', qty: 5.6, unit: 'KG', category: 'EXCIPIENT' },
    { name: 'Aerosil', qty: 2, unit: 'KG', category: 'EXCIPIENT' },
    { name: 'Dummy Filler', qty: 244, unit: 'KG', category: 'EXCIPIENT' },
  ];

  const multimax =
    (await db.product.findUnique({ where: { code: 'MULTIMAX-TAB' } })) ??
    (await db.product.create({
      data: {
        code: 'MULTIMAX-TAB',
        name: 'Multimax Tab',
        dosageForm: 'Tablet',
        strength: '800 mg',
        uom: 'TAB',
        packSize: '10 x 10',
        shelfLifeMonths: 24,
      },
    }));

  if (!(await db.formula.findFirst({ where: { productId: multimax.id } }))) {
    const materials = await Promise.all(multimaxIngredients.map(ensureMaterial));
    const f = await as(PR, () =>
      createFormula(
        {
          productId: multimax.id,
          baseBatchSize: 400000,
          baseBatchUnit: 'TAB',
          expectedYieldPct: 98,
          instructions:
            'Multivitamin/mineral tablet. Dispense actives and excipients per schedule, dry-mix, granulate, lubricate, compress to 800 mg fill weight (target batch weight 320 kg for 4 lac tablets). Source: client dispensing sheet, batch dated 17-Mar.',
          items: multimaxIngredients.map((ing, idx) => ({
            rawMaterialId: materials[idx].id,
            quantity: ing.qty,
            unit: ing.unit,
          })),
        },
        production.id,
      ),
    );
    await as(PR, () => submitFormula(f.id, production.id));
    await as(QC, () => approveFormula(f.id, qc.id, 'QC_MANAGER', 'Matches client-supplied dispensing record'));
    console.log(`Multimax Tab: formula v${f.version} created & approved (${materials.length} ingredients).`);
  } else {
    console.log('Multimax Tab already has a formula — skipped.');
  }

  // ───────── Healing OK ─────────
  const healingIngredients: Ing[] = [
    { name: 'L-Lysine', qty: 340, unit: 'G', category: 'API' },
    { name: 'Vitamin E (liquid)', qty: 171, unit: 'G', category: 'API' },
    { name: 'Vitamin B5 Gel', qty: 85, unit: 'G', category: 'API' },
    { name: 'Vitamin B1 (liquid grade)', qty: 52, unit: 'G', category: 'API' },
    { name: 'Vitamin B2 (liquid grade)', qty: 62, unit: 'G', category: 'API' },
    { name: 'Vitamin A Palmitate', qty: 7, unit: 'G', category: 'API' },
    { name: 'Iodine (liquid grade)', qty: 12, unit: 'G', category: 'API' },
    { name: 'Sorbitol', qty: 50, unit: 'KG', category: 'EXCIPIENT' },
    { name: 'Sucralose', qty: 100, unit: 'G', category: 'EXCIPIENT' },
    { name: 'Liquid Glucose', qty: 50, unit: 'KG', category: 'EXCIPIENT' },
    { name: 'Di Sodium EDTA (liquid grade)', qty: 100, unit: 'G', category: 'EXCIPIENT' },
    { name: 'SMP (liquid grade)', qty: 600, unit: 'G', category: 'EXCIPIENT' },
    { name: 'SPP (liquid grade)', qty: 250, unit: 'G', category: 'EXCIPIENT' },
    { name: 'Sodium Benzoate', qty: 600, unit: 'G', category: 'EXCIPIENT' },
    { name: 'Bronopol', qty: 200, unit: 'G', category: 'EXCIPIENT' },
    { name: 'Sodium Citrate', qty: 2, unit: 'KG', category: 'EXCIPIENT' },
    { name: 'Citric Acid', qty: 2, unit: 'KG', category: 'EXCIPIENT' },
    { name: 'Tween 80', qty: 2, unit: 'KG', category: 'EXCIPIENT' },
    { name: 'Acrysol K140', qty: 1, unit: 'KG', category: 'EXCIPIENT' },
    { name: 'Sodium Saccharin', qty: 1.5, unit: 'KG', category: 'EXCIPIENT' },
    { name: 'Xanthan Gum', qty: 2.5, unit: 'KG', category: 'EXCIPIENT' },
    { name: 'Sugar', qty: 30, unit: 'KG', category: 'EXCIPIENT' },
    { name: 'Flavour Mix Fruit Essence', qty: 500, unit: 'ML', category: 'OTHER', stockUom: 'ML' },
    { name: 'Orange Flavour', qty: 500, unit: 'ML', category: 'OTHER', stockUom: 'ML' },
  ];

  const healing =
    (await db.product.findUnique({ where: { code: 'HEALING-OK' } })) ??
    (await db.product.create({
      data: {
        code: 'HEALING-OK',
        name: 'Healing OK',
        dosageForm: 'Syrup',
        strength: '200 ml',
        uom: 'BTL',
        packSize: '200 ml bottle',
        shelfLifeMonths: 24,
      },
    }));

  if (!(await db.formula.findFirst({ where: { productId: healing.id } }))) {
    const materials = await Promise.all(healingIngredients.map(ensureMaterial));
    const f = await as(PR, () =>
      createFormula(
        {
          productId: healing.id,
          baseBatchSize: 1000,
          baseBatchUnit: 'L',
          expectedYieldPct: 98,
          instructions:
            'Multivitamin syrup. Dissolve actives and preservatives per schedule in purified water/glucose base, add sweeteners, gum and flavours, QS to 1000 L, fill 200 ml x 5000 bottles. Source: client dispensing sheet dated 1/9/2025.',
          items: healingIngredients.map((ing, idx) => ({
            rawMaterialId: materials[idx].id,
            quantity: ing.qty,
            unit: ing.unit,
          })),
        },
        production.id,
      ),
    );
    await as(PR, () => submitFormula(f.id, production.id));
    await as(QC, () => approveFormula(f.id, qc.id, 'QC_MANAGER', 'Matches client-supplied dispensing record'));
    console.log(`Healing OK: formula v${f.version} created & approved (${materials.length} ingredients).`);
  } else {
    console.log('Healing OK already has a formula — skipped.');
  }

  console.log('\nDone. Open Formulas & BOM in the app to see both, with full ingredient lists and cost calculation.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());