/**
 * DEMO MODE — in-memory stand-in for the backend.
 *
 * This module exists so the frontend can be shared as a live link without running the
 * Express/Prisma backend or a database. It holds a realistic, read-mostly snapshot of
 * demo data (the same shape the real API returns). Nothing is persisted: every server
 * restart (or fresh deploy) resets it.
 *
 * The real backend is untouched — see the repository root README for how to run it.
 */

const now = new Date();
const iso = (offsetDays: number, hour = 10, min = 30) => {
  const d = new Date(now);
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
};

export const DEMO_USERS: any[] = [
  { id: 'u-admin', email: 'admin@pharma.local', name: 'Meera Kulkarni', role: 'SUPER_ADMIN', password: 'Pharma@12345', permissions: ['*'] },
  { id: 'u-prod', email: 'production@pharma.local', name: 'Rahul Deshmukh', role: 'PRODUCTION_MANAGER', password: 'Pharma@12345', permissions: [] },
  { id: 'u-wh', email: 'warehouse@pharma.local', name: 'Sunita Patil', role: 'WAREHOUSE_MANAGER', password: 'Pharma@12345', permissions: [] },
  { id: 'u-qc', email: 'qc@pharma.local', name: 'Dr. Anjali Joshi', role: 'QC_MANAGER', password: 'Pharma@12345', permissions: [] },
  { id: 'u-pur', email: 'purchase@pharma.local', name: 'Vikram Shetty', role: 'PURCHASE_MANAGER', password: 'Pharma@12345', permissions: [] },
  { id: 'u-store', email: 'store@pharma.local', name: 'Amit Bhosale', role: 'STORE_OPERATOR', password: 'Pharma@12345', permissions: [] },
  { id: 'u-aud', email: 'auditor@pharma.local', name: 'Kavita Rao', role: 'AUDITOR', password: 'Pharma@12345', permissions: [] },
];

/** What each role can see/do in the demo — mirrors the real backend's permission matrix. */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ['*'],
  PRODUCTION_MANAGER: [
    'dashboard:read', 'notification:read', 'material:read', 'stock:read', 'supplier:read', 'purchase:read',
    'warehouse:read', 'formula:create', 'formula:read', 'formula:update', 'formula:submit', 'batch:create',
    'batch:read', 'batch:update', 'batch:approve', 'batch:start', 'batch:complete', 'production:read',
    'production:create', 'fg:read', 'qc:read', 'expiry:read', 'document:read', 'document:create', 'ai:read',
    'ai:bmr', 'ai:search', 'analytics:read', 'report:read', 'report:export', 'user:read',
  ],
  WAREHOUSE_MANAGER: [
    'dashboard:read', 'notification:read', 'material:read', 'material:update', 'stock:read', 'stock:create',
    'stock:transfer', 'stock:adjust', 'supplier:read', 'purchase:read', 'warehouse:read', 'warehouse:create',
    'formula:read', 'batch:read', 'production:read', 'fg:read', 'fg:update', 'stock:dispatch', 'qc:read',
    'expiry:read', 'expiry:update', 'document:read', 'document:create', 'analytics:read', 'report:read', 'user:read',
  ],
  QC_MANAGER: [
    'dashboard:read', 'notification:read', 'material:read', 'stock:read', 'warehouse:read', 'formula:read',
    'batch:read', 'batch:release', 'batch:reject', 'production:read', 'fg:read', 'qc:read', 'qc:update',
    'expiry:read', 'expiry:recall', 'document:read', 'document:create', 'ai:read', 'analytics:read',
    'report:read', 'report:export', 'user:read',
  ],
  PURCHASE_MANAGER: [
    'dashboard:read', 'notification:read', 'material:read', 'stock:read', 'supplier:read', 'supplier:update',
    'purchase:read', 'purchase:create', 'purchase:approve', 'purchase:grn', 'warehouse:read', 'formula:read',
    'batch:read', 'production:read', 'qc:read', 'expiry:read', 'document:read', 'document:create', 'ai:read',
    'ai:invoice', 'analytics:read', 'report:read', 'report:export', 'user:read',
  ],
  STORE_OPERATOR: [
    'dashboard:read', 'notification:read', 'material:read', 'stock:read', 'stock:create', 'stock:transfer',
    'warehouse:read', 'formula:read', 'batch:read', 'production:read', 'fg:read', 'qc:read', 'expiry:read',
    'document:read', 'report:read',
  ],
  AUDITOR: [
    'dashboard:read', 'notification:read', 'material:read', 'stock:read', 'supplier:read', 'purchase:read',
    'warehouse:read', 'formula:read', 'batch:read', 'production:read', 'fg:read', 'qc:read', 'expiry:read',
    'document:read', 'audit:read', 'ai:read', 'analytics:read', 'report:read', 'report:export', 'user:read',
  ],
};

// ---------------------------------------------------------------- masters
export const suppliers: any[] = [
  { id: 'sup-1', code: 'SUP-001', name: 'Gujarat Pharma Chem', gstin: '24AABCG1234A1Z5', contactName: 'Nilesh Patel', email: 'sales@gujaratpharmachem.in', phone: '+91 98240 11223', paymentTerms: 'Net 30', address: 'Plot 21, GIDC Vatva, Ahmedabad', isApproved: true },
  { id: 'sup-2', code: 'SUP-002', name: 'Fine Excipients Pvt Ltd', gstin: '27AAECF5678B1Z9', contactName: 'Rohit Malhotra', email: 'orders@fineexcipients.com', phone: '+91 98200 44556', paymentTerms: 'Net 45', address: 'Andheri East, Mumbai', isApproved: true },
  { id: 'sup-3', code: 'SUP-003', name: 'MediPack Industries', gstin: '29AAGCM9012C1Z3', contactName: 'Lakshmi Rao', email: 'info@medipack.in', phone: '+91 98860 77889', paymentTerms: 'Advance', address: 'Peenya, Bengaluru', isApproved: true },
  { id: 'sup-4', code: 'SUP-004', name: 'Deccan Solvents', gstin: '36AAHCD3456D1Z7', contactName: 'Arvind Kumar', email: 'deccansolvents@gmail.com', phone: '+91 90000 33221', paymentTerms: 'Net 15', address: 'Jeedimetla, Hyderabad', isApproved: false },
];

export const warehouses: any[] = [
  { id: 'wh-1', code: 'WH-RM', name: 'Raw Material Store', type: 'RAW_MATERIAL', address: 'Plant 1, Ground floor', _count: { racks: 4, bins: 12 } },
  { id: 'wh-2', code: 'WH-FG', name: 'Finished Goods Warehouse', type: 'FINISHED_GOODS', address: 'Plant 1, First floor', _count: { racks: 3, bins: 9 } },
  { id: 'wh-3', code: 'WH-QUAR', name: 'Quarantine Area', type: 'QUARANTINE', address: 'Plant 1, Ground floor (restricted)', _count: { racks: 2, bins: 6 } },
  { id: 'wh-4', code: 'WH-COLD', name: 'Cold Storage', type: 'COLD_STORAGE', address: 'Plant 1, Basement (2–8 °C)', _count: { racks: 1, bins: 4 } },
];

export const racks: any[] = [
  { id: 'rk-1', code: 'R1-A', description: 'API rack', warehouseId: 'wh-1', warehouse: warehouses[0] },
  { id: 'rk-2', code: 'R1-B', description: 'Excipient rack', warehouseId: 'wh-1', warehouse: warehouses[0] },
  { id: 'rk-3', code: 'R2-A', description: 'Pallet rack', warehouseId: 'wh-2', warehouse: warehouses[1] },
  { id: 'rk-4', code: 'R3-A', description: 'Quarantine rack', warehouseId: 'wh-3', warehouse: warehouses[2] },
];

export const bins: any[] = [
  { id: 'bin-1', code: 'R1-A-01', barcode: 'BIN|RM|R1-A-01', rackId: 'rk-1', rack: racks[0] },
  { id: 'bin-2', code: 'R1-A-02', barcode: 'BIN|RM|R1-A-02', rackId: 'rk-1', rack: racks[0] },
  { id: 'bin-3', code: 'R1-B-01', barcode: 'BIN|RM|R1-B-01', rackId: 'rk-2', rack: racks[1] },
  { id: 'bin-4', code: 'R2-A-01', barcode: 'BIN|FG|R2-A-01', rackId: 'rk-3', rack: racks[2] },
  { id: 'bin-5', code: 'R3-A-01', barcode: 'BIN|QU|R3-A-01', rackId: 'rk-4', rack: racks[3] },
];

export const rawMaterials: any[] = [
  { id: 'rm-1', code: 'RM-PARA', name: 'Paracetamol IP', category: 'API', uom: 'KG', minStock: 150, reorderLevel: 300, purchasePrice: 820, shelfLifeMonths: 60, hsnCode: '2924', gstRate: 12, storageCondition: 'Below 30 °C, dry', barcode: 'RM|RM-PARA', usableStock: 412.5, quarantineStock: 60, stockState: 'OK', defaultSupplierId: 'sup-1' },
  { id: 'rm-2', code: 'RM-STARCH', name: 'Starch (Maize) IP', category: 'EXCIPIENT', uom: 'KG', minStock: 100, reorderLevel: 200, purchasePrice: 95, shelfLifeMonths: 36, hsnCode: '1108', gstRate: 5, storageCondition: 'Below 30 °C, dry', barcode: 'RM|RM-STARCH', usableStock: 86, quarantineStock: 0, stockState: 'REORDER', defaultSupplierId: 'sup-2' },
  { id: 'rm-3', code: 'RM-MAGST', name: 'Magnesium Stearate', category: 'EXCIPIENT', uom: 'KG', minStock: 25, reorderLevel: 50, purchasePrice: 340, shelfLifeMonths: 48, hsnCode: '2916', gstRate: 12, storageCondition: 'Below 30 °C', barcode: 'RM|RM-MAGST', usableStock: 44.2, quarantineStock: 0, stockState: 'OK', defaultSupplierId: 'sup-2' },
  { id: 'rm-4', code: 'RM-PVP', name: 'PVP K-30', category: 'EXCIPIENT', uom: 'KG', minStock: 20, reorderLevel: 40, purchasePrice: 1450, shelfLifeMonths: 48, hsnCode: '3905', gstRate: 18, storageCondition: 'Below 25 °C', barcode: 'RM|RM-PVP', usableStock: 12.5, quarantineStock: 8, stockState: 'CRITICAL', defaultSupplierId: 'sup-2' },
  { id: 'rm-5', code: 'RM-COAT', name: 'Opadry White Coating', category: 'COATING', uom: 'KG', minStock: 15, reorderLevel: 30, purchasePrice: 2350, shelfLifeMonths: 36, hsnCode: '3206', gstRate: 18, storageCondition: 'Below 25 °C', barcode: 'RM|RM-COAT', usableStock: 21.8, quarantineStock: 0, stockState: 'OK', defaultSupplierId: 'sup-3' },
  { id: 'rm-6', code: 'RM-PVC', name: 'PVC Foil (Blister)', category: 'PACKAGING', uom: 'KG', minStock: 40, reorderLevel: 80, purchasePrice: 210, shelfLifeMonths: 60, hsnCode: '3920', gstRate: 18, storageCondition: 'Ambient', barcode: 'RM|RM-PVC', usableStock: 132, quarantineStock: 0, stockState: 'OK', defaultSupplierId: 'sup-3' },
  { id: 'rm-7', code: 'RM-ALU', name: 'Aluminium Foil', category: 'PACKAGING', uom: 'KG', minStock: 30, reorderLevel: 60, purchasePrice: 380, shelfLifeMonths: 60, hsnCode: '7607', gstRate: 18, storageCondition: 'Ambient', barcode: 'RM|RM-ALU', usableStock: 0, quarantineStock: 0, stockState: 'OUT_OF_STOCK', defaultSupplierId: 'sup-3' },
  { id: 'rm-8', code: 'RM-IPC', name: 'Isopropyl Alcohol', category: 'SOLVENT', uom: 'L', minStock: 50, reorderLevel: 100, purchasePrice: 130, shelfLifeMonths: 24, hsnCode: '2905', gstRate: 18, storageCondition: 'Flammable cabinet', barcode: 'RM|RM-IPC', usableStock: 97.5, quarantineStock: 0, stockState: 'OK', defaultSupplierId: 'sup-4' },
];

export const products: any[] = [
  { id: 'prd-1', code: 'FG-PARA500', name: 'Paracetamol 500 mg', dosageForm: 'Tablet', strength: '500 mg', uom: 'TAB', packSize: '10×10 blisters', shelfLifeMonths: 24, sellingPrice: 1.35 },
  { id: 'prd-2', code: 'FG-AMOX500', name: 'Amoxicillin 500 mg', dosageForm: 'Capsule', strength: '500 mg', uom: 'CAP', packSize: '10×10', shelfLifeMonths: 24, sellingPrice: 4.2 },
  { id: 'prd-3', code: 'FG-ORS', name: 'ORS Powder Sachet', dosageForm: 'Sachet', strength: '21.8 g', uom: 'SAC', packSize: '21.8 g sachet', shelfLifeMonths: 30, sellingPrice: 6.5 },
];

export const formulas: any[] = [
  {
    id: 'fmt-1', productId: 'prd-1', product: products[0], version: 2, status: 'APPROVED', baseBatchSize: 300000, baseBatchUnit: 'TAB',
    expectedYieldPct: 98, expectedWastagePct: 2, effectiveFrom: iso(-120), approvedAt: iso(-110), changeReason: 'Coating supplier changed; minor lubricant qty revision',
    instructions: '1. Dispense API and excipients as per BOM.\n2. Wet granulate with PVP solution (IPAs 12 L).\n3. Dry at 60 °C to LOD 1.5–2.5%.\n4. Blend with magnesium stearate 8 min.\n5. Compress at 18–20 kN hardness.\n6. Coat to 3% weight gain.\n7. Blister pack 10×10.',
    createdById: 'u-prod', approvedById: 'u-admin', standardCost: 268000,
    _count: { items: 6 },
    items: [
      { id: 'fi-1', rawMaterialId: 'rm-1', quantity: 150, unit: 'KG', wastagePct: 1, stage: 'Dispensing' },
      { id: 'fi-2', rawMaterialId: 'rm-2', quantity: 22.5, unit: 'KG', wastagePct: 2, stage: 'Granulation' },
      { id: 'fi-3', rawMaterialId: 'rm-4', quantity: 4.5, unit: 'KG', wastagePct: 2, stage: 'Granulation' },
      { id: 'fi-4', rawMaterialId: 'rm-3', quantity: 2.25, unit: 'KG', wastagePct: 1, stage: 'Blending' },
      { id: 'fi-5', rawMaterialId: 'rm-5', quantity: 9, unit: 'KG', wastagePct: 3, stage: 'Coating' },
      { id: 'fi-6', rawMaterialId: 'rm-6', quantity: 13.5, unit: 'KG', wastagePct: 2, stage: 'Packing' },
    ],
    users: [DEMO_USERS[0], DEMO_USERS[1]].map(({ id, name, role }) => ({ id, name, role })),
    history: [
      { id: 'fh-1', action: 'CREATED', userId: 'u-prod', createdAt: iso(-120), remarks: 'v2 draft after coating supplier change' },
      { id: 'fh-2', action: 'SUBMITTED', userId: 'u-prod', createdAt: iso(-115) },
      { id: 'fh-3', action: 'APPROVED', userId: 'u-admin', createdAt: iso(-110), remarks: 'Verified against pharmacopoeia' },
    ],
  },
  {
    id: 'fmt-2', productId: 'prd-2', product: products[1], version: 1, status: 'PENDING_APPROVAL', baseBatchSize: 200000, baseBatchUnit: 'CAP',
    expectedYieldPct: 97, expectedWastagePct: 3, effectiveFrom: iso(-9), approvedAt: null, changeReason: null,
    instructions: '1. Dispense and sift API.\n2. Dry blend with excipients.\n3. Encapsulate on line 2.\n4. Polish and sort.\n5. Blister pack.',
    createdById: 'u-prod', approvedById: null, standardCost: null,
    _count: { items: 4 },
    items: [
      { id: 'fi-7', rawMaterialId: 'rm-1', quantity: 0, unit: 'KG', wastagePct: 1, stage: 'Dispensing' },
      { id: 'fi-8', rawMaterialId: 'rm-2', quantity: 30, unit: 'KG', wastagePct: 2, stage: 'Blending' },
      { id: 'fi-9', rawMaterialId: 'rm-3', quantity: 1.2, unit: 'KG', wastagePct: 1, stage: 'Blending' },
      { id: 'fi-10', rawMaterialId: 'rm-7', quantity: 9.5, unit: 'KG', wastagePct: 3, stage: 'Packing' },
    ],
    users: [DEMO_USERS[1]].map(({ id, name, role }) => ({ id, name, role })),
    history: [
      { id: 'fh-4', action: 'CREATED', userId: 'u-prod', createdAt: iso(-9), remarks: 'New product introduction' },
      { id: 'fh-5', action: 'SUBMITTED', userId: 'u-prod', createdAt: iso(-8) },
    ],
  },
];

export const materialLots: any[] = [
  { id: 'lot-1', lotNumber: 'LOT-2501-001', rawMaterialId: 'rm-1', supplierLot: 'GPC-4412', status: 'APPROVED', availableQty: 240.5, unitCost: 805, expiryDate: iso(420), receivedAt: iso(-95), warehouseId: 'wh-1', binId: 'bin-1' },
  { id: 'lot-2', lotNumber: 'LOT-2501-002', rawMaterialId: 'rm-2', supplierLot: 'FE-2201', status: 'APPROVED', availableQty: 86, unitCost: 92, expiryDate: iso(150), receivedAt: iso(-300), warehouseId: 'wh-1', binId: 'bin-3' },
  { id: 'lot-3', lotNumber: 'LOT-2503-001', rawMaterialId: 'rm-1', supplierLot: 'GPC-4489', status: 'QUARANTINE', availableQty: 60, unitCost: 830, expiryDate: iso(540), receivedAt: iso(-2), warehouseId: 'wh-3', binId: 'bin-5' },
  { id: 'lot-4', lotNumber: 'LOT-2502-004', rawMaterialId: 'rm-4', supplierLot: 'FE-2277', status: 'APPROVED', availableQty: 12.5, unitCost: 1440, expiryDate: iso(75), receivedAt: iso(-210), warehouseId: 'wh-1', binId: 'bin-2' },
  { id: 'lot-5', lotNumber: 'LOT-2502-006', rawMaterialId: 'rm-5', supplierLot: 'MP-8801', status: 'APPROVED', availableQty: 21.8, unitCost: 2340, expiryDate: iso(600), receivedAt: iso(-180), warehouseId: 'wh-1', binId: 'bin-2' },
  { id: 'lot-6', lotNumber: 'LOT-2502-009', rawMaterialId: 'rm-8', supplierLot: 'DS-3320', status: 'APPROVED', availableQty: 97.5, unitCost: 128, expiryDate: iso(260), receivedAt: iso(-120), warehouseId: 'wh-4', binId: null },
  { id: 'lot-7', lotNumber: 'LOT-2502-011', rawMaterialId: 'rm-6', supplierLot: 'MP-8844', status: 'APPROVED', availableQty: 132, unitCost: 205, expiryDate: iso(700), receivedAt: iso(-160), warehouseId: 'wh-1', binId: 'bin-3' },
  { id: 'lot-8', lotNumber: 'LOT-2412-002', rawMaterialId: 'rm-2', supplierLot: 'FE-1980', status: 'EXPIRED', availableQty: 9.2, unitCost: 90, expiryDate: iso(-6), receivedAt: iso(-380), warehouseId: 'wh-1', binId: 'bin-3' },
];

export const batches: any[] = [
  {
    id: 'bat-1', batchNumber: 'B2503-001', productId: 'prd-1', product: products[0], formulaId: 'fmt-1', formula: formulas[0], status: 'RELEASED', qcStatus: 'PASSED', source: 'SYSTEM',
    batchSize: 300000, batchUnit: 'TAB', mfgDate: iso(-60), expiryDate: iso(665), actualYield: 294510, yieldPct: 98.17, wastagePct: 1.83,
    theoreticalYield: 294000, materialCost: 265400, costPerUnit: 0.9, createdById: 'u-prod', releasedAt: iso(-35),
    materials: [
      { id: 'bm-1', rawMaterial: { code: 'RM-PARA', name: 'Paracetamol IP' }, requiredQty: 151.5, issuedQty: 151.5, unit: 'KG', consumptions: [{ id: 'bc-1', quantity: 151.5, materialLot: { lotNumber: 'LOT-2501-001', expiryDate: iso(420), supplier: { name: 'Gujarat Pharma Chem' } } }] },
      { id: 'bm-2', rawMaterial: { code: 'RM-STARCH', name: 'Starch (Maize) IP' }, requiredQty: 22.95, issuedQty: 22.95, unit: 'KG', consumptions: [{ id: 'bc-2', quantity: 22.95, materialLot: { lotNumber: 'LOT-2501-002', expiryDate: iso(150), supplier: { name: 'Fine Excipients Pvt Ltd' } } }] },
      { id: 'bm-3', rawMaterial: { code: 'RM-COAT', name: 'Opadry White Coating' }, requiredQty: 9.27, issuedQty: 9.27, unit: 'KG', consumptions: [{ id: 'bc-3', quantity: 9.27, materialLot: { lotNumber: 'LOT-2502-006', expiryDate: iso(600), supplier: { name: 'MediPack Industries' } } }] },
    ],
    qcSamples: [
      { id: 'qc-1', sampleNumber: 'QCF-2503-001', type: 'FINISHED_PRODUCT', status: 'PASSED', collectedAt: iso(-52), results: [
        { id: 'qr-1', parameter: 'Assay', specification: '95.0 – 105.0 %', resultValue: '99.6', unit: '%', passed: true },
        { id: 'qr-2', parameter: 'Uniformity of weight', specification: '± 5%', resultValue: '±1.8', unit: '%', passed: true },
        { id: 'qr-3', parameter: 'Dissolution (30 min)', specification: '≥ 80 %', resultValue: '92', unit: '%', passed: true },
      ] },
    ],
    signatures: [
      { id: 'sig-1', meaning: 'BATCH_APPROVED', user: { name: 'Meera Kulkarni', role: 'SUPER_ADMIN' }, createdAt: iso(-64), hash: 'a1b2c3d4e5f60718' },
      { id: 'sig-2', meaning: 'BATCH_RELEASED', user: { name: 'Dr. Anjali Joshi', role: 'QC_MANAGER' }, createdAt: iso(-35), hash: 'b2c3d4e5f6071899' },
    ],
    history: [
      { id: 'bh-1', toStatus: 'DRAFT', createdAt: iso(-64), remarks: 'Planned from work order WO-2502-004' },
      { id: 'bh-2', toStatus: 'APPROVED', createdAt: iso(-63) },
      { id: 'bh-3', toStatus: 'IN_PRODUCTION', createdAt: iso(-60), remarks: 'FEFO issue: LOT-2501-001, LOT-2501-002' },
      { id: 'bh-4', toStatus: 'QC_REVIEW', createdAt: iso(-53), remarks: 'Actual yield 294,510 TAB' },
      { id: 'bh-5', toStatus: 'RELEASED', createdAt: iso(-35), remarks: 'All QC parameters pass' },
    ],
  },
  {
    id: 'bat-2', batchNumber: 'B2504-001', productId: 'prd-1', product: products[0], formulaId: 'fmt-1', formula: formulas[0], status: 'IN_PRODUCTION', qcStatus: 'PENDING', source: 'SYSTEM',
    batchSize: 300000, batchUnit: 'TAB', mfgDate: iso(-2), expiryDate: iso(723), actualYield: null, yieldPct: null, wastagePct: null,
    theoreticalYield: 294000, materialCost: null, costPerUnit: null, createdById: 'u-prod', releasedAt: null,
    materials: [
      { id: 'bm-4', rawMaterial: { code: 'RM-PARA', name: 'Paracetamol IP' }, requiredQty: 151.5, issuedQty: 151.5, unit: 'KG', consumptions: [{ id: 'bc-4', quantity: 151.5, materialLot: { lotNumber: 'LOT-2501-001', expiryDate: iso(420), supplier: { name: 'Gujarat Pharma Chem' } } }] },
      { id: 'bm-5', rawMaterial: { code: 'RM-PVP', name: 'PVP K-30' }, requiredQty: 4.59, issuedQty: 4.59, unit: 'KG', consumptions: [{ id: 'bc-5', quantity: 4.59, materialLot: { lotNumber: 'LOT-2502-004', expiryDate: iso(75), supplier: { name: 'Fine Excipients Pvt Ltd' } } }] },
    ],
    qcSamples: [],
    signatures: [{ id: 'sig-3', meaning: 'BATCH_APPROVED', user: { name: 'Meera Kulkarni', role: 'SUPER_ADMIN' }, createdAt: iso(-3), hash: 'c3d4e5f607189900' }],
    history: [
      { id: 'bh-6', toStatus: 'DRAFT', createdAt: iso(-4), remarks: 'Scheduled work order WO-2503-002' },
      { id: 'bh-7', toStatus: 'APPROVED', createdAt: iso(-3) },
      { id: 'bh-8', toStatus: 'IN_PRODUCTION', createdAt: iso(-2), remarks: 'Compression stage' },
    ],
  },
  {
    id: 'bat-3', batchNumber: 'B2503-005', productId: 'prd-1', product: products[0], formulaId: 'fmt-1', formula: formulas[0], status: 'QC_REVIEW', qcStatus: 'IN_TESTING', source: 'AI_IMPORT',
    batchSize: 300000, batchUnit: 'TAB', mfgDate: iso(-18), expiryDate: iso(707), actualYield: 290820, yieldPct: 98.92, wastagePct: 1.08,
    theoreticalYield: 294000, materialCost: 266100, costPerUnit: 0.91, createdById: 'u-prod', releasedAt: null,
    materials: [
      { id: 'bm-6', rawMaterial: { code: 'RM-PARA', name: 'Paracetamol IP' }, requiredQty: 151.5, issuedQty: null, unit: 'KG', consumptions: [] },
      { id: 'bm-7', rawMaterial: { code: 'RM-STARCH', name: 'Starch (Maize) IP' }, requiredQty: 22.95, issuedQty: null, unit: 'KG', consumptions: [] },
    ],
    qcSamples: [
      { id: 'qc-2', sampleNumber: 'QCF-2503-005', type: 'FINISHED_PRODUCT', status: 'IN_TESTING', collectedAt: iso(-11), results: [
        { id: 'qr-4', parameter: 'Assay', specification: '95.0 – 105.0 %', resultValue: '100.4', unit: '%', passed: true },
      ] },
    ],
    signatures: [{ id: 'sig-4', meaning: 'BATCH_APPROVED', user: { name: 'Meera Kulkarni', role: 'SUPER_ADMIN' }, createdAt: iso(-19), hash: 'd4e5f60718990011' }],
    history: [
      { id: 'bh-9', toStatus: 'DRAFT', createdAt: iso(-20), remarks: 'Imported from scanned BMR (Document AI)' },
      { id: 'bh-10', toStatus: 'APPROVED', createdAt: iso(-19) },
      { id: 'bh-11', toStatus: 'IN_PRODUCTION', createdAt: iso(-18) },
      { id: 'bh-12', toStatus: 'QC_REVIEW', createdAt: iso(-11) },
    ],
  },
  {
    id: 'bat-4', batchNumber: 'B2503-002', productId: 'prd-3', product: products[2], formulaId: null, formula: null, status: 'DRAFT', qcStatus: 'PENDING', source: 'SYSTEM',
    batchSize: 50000, batchUnit: 'SAC', mfgDate: iso(-1), expiryDate: iso(730), actualYield: null, yieldPct: null, wastagePct: null,
    theoreticalYield: 49000, materialCost: null, costPerUnit: null, createdById: 'u-store', releasedAt: null,
    materials: [], qcSamples: [], signatures: [],
    history: [{ id: 'bh-13', toStatus: 'DRAFT', createdAt: iso(-1), remarks: 'Awaiting approval' }],
  },
];

export const purchaseOrders: any[] = [
  {
    id: 'po-1', poNumber: 'PO-2503-001', supplierId: 'sup-1', supplier: suppliers[0], orderDate: iso(-30), status: 'RECEIVED', total: 542640,
    _count: { items: 2 },
    items: [
      { id: 'pi-1', rawMaterialId: 'rm-1', rawMaterial: { code: 'RM-PARA', name: 'Paracetamol IP', uom: 'KG' }, quantity: 300, receivedQty: 300, unitPrice: 820, taxPct: 12 },
      { id: 'pi-2', rawMaterialId: 'rm-5', rawMaterial: { code: 'RM-COAT', name: 'Opadry White Coating', uom: 'KG' }, quantity: 90, receivedQty: 90, unitPrice: 2350, taxPct: 18 },
    ],
  },
  {
    id: 'po-2', poNumber: 'PO-2504-002', supplierId: 'sup-2', supplier: suppliers[1], orderDate: iso(-4), status: 'DRAFT', total: 101500,
    _count: { items: 2 },
    items: [
      { id: 'pi-3', rawMaterialId: 'rm-2', rawMaterial: { code: 'RM-STARCH', name: 'Starch (Maize) IP', uom: 'KG' }, quantity: 500, receivedQty: 0, unitPrice: 95, taxPct: 5 },
      { id: 'pi-4', rawMaterialId: 'rm-4', rawMaterial: { code: 'RM-PVP', name: 'PVP K-30', uom: 'KG' }, quantity: 40, receivedQty: 0, unitPrice: 1350, taxPct: 18 },
    ],
  },
  {
    id: 'po-3', poNumber: 'PO-2503-003', supplierId: 'sup-3', supplier: suppliers[2], orderDate: iso(-21), status: 'PARTIALLY_RECEIVED', total: 87600,
    _count: { items: 1 },
    items: [{ id: 'pi-5', rawMaterialId: 'rm-6', rawMaterial: { code: 'RM-PVC', name: 'PVC Foil (Blister)', uom: 'KG' }, quantity: 400, receivedQty: 240, unitPrice: 219, taxPct: 18 }],
  },
];

export const grns: any[] = [
  {
    id: 'grn-1', grnNumber: 'GRN-2503-001', supplierId: 'sup-1', supplier: suppliers[0], poId: 'po-1', po: purchaseOrders[0], receivedAt: iso(-25), status: 'COMPLETED', _count: { items: 2 },
    items: [
      { id: 'gi-1', rawMaterial: { code: 'RM-PARA', name: 'Paracetamol IP' }, lotNumber: 'GPC-4412', quantity: 300, rejectedQty: 0 },
      { id: 'gi-2', rawMaterial: { code: 'RM-COAT', name: 'Opadry White Coating' }, lotNumber: 'MP-8801', quantity: 90, rejectedQty: 1 },
    ],
  },
  {
    id: 'grn-2', grnNumber: 'GRN-2503-002', supplierId: 'sup-3', supplier: suppliers[2], poId: 'po-3', po: purchaseOrders[2], receivedAt: iso(-16), status: 'COMPLETED', _count: { items: 1 },
    items: [{ id: 'gi-3', rawMaterial: { code: 'RM-PVC', name: 'PVC Foil (Blister)' }, lotNumber: 'MP-8844', quantity: 240, rejectedQty: 0 }],
  },
];

export const invoices: any[] = [
  {
    id: 'inv-1', invoiceNumber: 'INV-GPC-7781', supplierId: 'sup-1', supplier: suppliers[0], poId: 'po-1', po: purchaseOrders[0], grnId: 'grn-1', grn: grns[0],
    invoiceDate: iso(-24), total: 542640, status: 'MATCHED', source: 'MANUAL',
    matchResult: { status: 'MATCHED', flags: [], priceMismatch: [], quantityMismatch: [] },
    items: [
      { id: 'ii-1', description: 'Paracetamol IP — 300 KG', rawMaterialId: 'rm-1', rawMaterial: { code: 'RM-PARA' }, quantity: 300, unitPrice: 820, amount: 246000, taxPct: 12 },
      { id: 'ii-2', description: 'Opadry White Coating — 90 KG', rawMaterialId: 'rm-5', rawMaterial: { code: 'RM-COAT' }, quantity: 90, unitPrice: 2350, amount: 211500, taxPct: 18 },
    ],
  },
  {
    id: 'inv-2', invoiceNumber: 'INV-FE-2277', supplierId: 'sup-2', supplier: suppliers[1], poId: null, po: null, grnId: null, grn: null,
    invoiceDate: iso(-7), total: 89000, status: 'PENDING_REVIEW', source: 'AI_IMPORT',
    matchResult: {
      status: 'MISMATCH',
      flags: [
        { severity: 'WARNING', code: 'PO_NOT_FOUND', message: 'No purchase order matched for this invoice — verify before approval.' },
        { severity: 'INFO', code: 'NEW_SUPPLIER_PATTERN', message: 'Invoice total differs from the last 3 invoices of this supplier by >25%.' },
      ],
      priceMismatch: [{ description: 'PVP K-30', basis: 'last purchase price', invoiced: 1580, expected: 1350, deviationPct: 17.0 }],
      quantityMismatch: [],
    },
    items: [{ id: 'ii-3', description: 'PVP K-30 — 25 KG', rawMaterialId: 'rm-4', rawMaterial: { code: 'RM-PVP' }, quantity: 25, unitPrice: 1580, amount: 39500, taxPct: 18 }],
  },
];

export const requisitions: any[] = [
  {
    id: 'pr-1', prNumber: 'PR-2504-001', status: 'SUBMITTED', notes: 'Auto-raised from reorder levels', createdAt: iso(-2),
    items: [{ id: 'pri-1', rawMaterial: { name: 'Starch (Maize) IP', uom: 'KG' }, quantity: 200 }, { id: 'pri-2', rawMaterial: { name: 'Aluminium Foil', uom: 'KG' }, quantity: 60 }],
  },
];

export const qcSamples: any[] = [
  { id: 'qc-1', sampleNumber: 'QCF-2503-001', type: 'FINISHED_PRODUCT', status: 'PASSED', collectedAt: iso(-52), analystId: 'u-qc', batchId: 'bat-1', batch: { product: { name: 'Paracetamol 500 mg' }, batchNumber: 'B2503-001' }, materialLotId: null, materialLot: null, coa: { documentId: 'doc-coa-1', coaNumber: 'COA-2503-001' }, _count: { results: 3 },
    results: [
      { id: 'qr-1', parameter: 'Assay', specification: '95.0 – 105.0 %', resultValue: '99.6', numericValue: 99.6, unit: '%', passed: true },
      { id: 'qr-2', parameter: 'Uniformity of weight', specification: '± 5%', resultValue: '±1.8', numericValue: null, unit: '%', passed: true },
      { id: 'qr-3', parameter: 'Dissolution (30 min)', specification: '≥ 80 %', resultValue: '92', numericValue: 92, unit: '%', passed: true },
    ] },
  { id: 'qc-3', sampleNumber: 'QCR-2503-001', type: 'RAW_MATERIAL', status: 'PASSED', collectedAt: iso(-24), analystId: 'u-qc', batchId: null, batch: null, materialLotId: 'lot-3', materialLot: { rawMaterial: { name: 'Paracetamol IP' }, lotNumber: 'LOT-2503-001' }, coa: null, _count: { results: 2 },
    results: [
      { id: 'qr-5', parameter: 'Appearance', specification: 'White crystalline powder', resultValue: 'Conforms', numericValue: null, unit: '', passed: true },
      { id: 'qr-6', parameter: 'Loss on drying', specification: '≤ 0.5 %', resultValue: '0.22', numericValue: 0.22, unit: '%', passed: true },
    ] },
  { id: 'qc-2', sampleNumber: 'QCF-2503-005', type: 'FINISHED_PRODUCT', status: 'IN_TESTING', collectedAt: iso(-11), analystId: 'u-qc', batchId: 'bat-3', batch: { product: { name: 'Paracetamol 500 mg' }, batchNumber: 'B2503-005' }, materialLotId: null, materialLot: null, coa: null, _count: { results: 1 },
    results: [{ id: 'qr-4', parameter: 'Assay', specification: '95.0 – 105.0 %', resultValue: '100.4', numericValue: 100.4, unit: '%', passed: true }] },
  { id: 'qc-4', sampleNumber: 'QCR-2504-002', type: 'RAW_MATERIAL', status: 'PENDING', collectedAt: iso(-1), analystId: 'u-qc', batchId: null, batch: null, materialLotId: 'lot-3', materialLot: { rawMaterial: { name: 'Paracetamol IP' }, lotNumber: 'LOT-2503-001' }, coa: null, _count: { results: 0 }, results: [] },
];

export const fgLots: any[] = [
  { id: 'fg-1', batchId: 'bat-1', batch: batches[0], product: products[0], mfgDate: iso(-60), expiryDate: iso(665), status: 'RELEASED', availableQty: 289000, reservedQty: 24000, warehouseId: 'wh-2', binId: 'bin-4', warehouse: warehouses[1], bin: bins[3] },
  { id: 'fg-2', batchId: 'bat-3', batch: batches[2], product: products[0], mfgDate: iso(-18), expiryDate: iso(707), status: 'QUARANTINE', availableQty: 290820, reservedQty: 0, warehouseId: 'wh-3', binId: 'bin-5', warehouse: warehouses[2], bin: bins[4] },
];

export const dispatches: any[] = [
  {
    id: 'dsp-1', dispatchNumber: 'DSP-2503-001', dispatchedAt: iso(-12), customer: 'City Chemist Chain', destination: 'Pune, MH', invoiceRef: 'SL-8821', vehicleNo: 'MH12 AB 4477',
    items: [{ id: 'di-1', quantity: 24000, fgLot: fgLots[0] }],
  },
];

export const documents: any[] = [
  { id: 'doc-bmr-1', title: 'BMR — B2503-005 (scanned)', type: 'BMR', version: 1, size: 1_842_000, fileName: 'bmr-b2503-005.pdf', mimeType: 'application/pdf', allowedRoles: [], createdAt: iso(-20) },
  { id: 'doc-coa-1', title: 'COA — B2503-001', type: 'COA', version: 2, size: 302_000, fileName: 'coa-b2503-001.pdf', mimeType: 'application/pdf', allowedRoles: [], createdAt: iso(-35) },
  { id: 'doc-gst-1', title: 'GST bill — INV-FE-2277', type: 'SUPPLIER_INVOICE', version: 1, size: 96_000, fileName: 'inv-fe-2277.pdf', mimeType: 'application/pdf', allowedRoles: ['PURCHASE_MANAGER'], createdAt: iso(-7) },
  { id: 'doc-sop-1', title: 'SOP-041 — Dispensing', type: 'OTHER', version: 3, size: 158_000, fileName: 'sop-041-dispensing.pdf', mimeType: 'application/pdf', allowedRoles: [], createdAt: iso(-90) },
];

export const aiJobs: any[] = [
  {
    id: 'job-1', kind: 'BMR', status: 'APPROVED', confidence: 0.94, createdAt: iso(-20), updatedAt: iso(-19),
    document: { fileName: 'bmr-b2503-005.pdf', mimeType: 'application/pdf' }, error: null, createdBatchId: 'bat-3', createdInvoiceId: null,
    corrected: null, validation: { engine: 'keyword-rules', report: { score: 88, verdict: 'PASS', findings: [{ severity: 'WARNING', code: 'YIELD_TREND', message: 'Yield is 1.2σ above this product’s 6-batch average — verify actuals.' }] }, match: null },
    extracted: {
      fieldConfidence: { batchNumber: 0.98, productId: 0.92, manufacturingDate: 0.9, expiryDate: 0.88, 'batchSize.value': 0.71, operatorName: 0.4 },
      illegibleFields: ['operatorName'],
      batchNumber: 'B2503-005', productName: 'Paracetamol 500', formulaVersion: 'v2', manufacturingDate: iso(-18).slice(0, 10), expiryDate: iso(707).slice(0, 10),
      batchSize: { value: 300000, unit: 'TAB' }, operatorId: null, operatorName: 'R____ D______', qcStatus: 'PENDING',
      yield: { theoretical: 294000, actual: 290820, percent: 98.92 },
      ingredients: [{ name: 'Paracetamol IP', rawMaterialId: 'rm-1', quantity: 151.5, unit: 'KG' }, { name: 'Starch', rawMaterialId: 'rm-2', quantity: 22.95, unit: 'KG' }],
      materialConsumption: [{ name: 'Paracetamol IP', rawMaterialId: 'rm-1', plannedQty: 151.5, actualQty: 151.5, unit: 'KG', lotNumber: 'LOT-2501-001' }],
    },
  },
  {
    id: 'job-2', kind: 'INVOICE', status: 'REVIEW', confidence: 0.81, createdAt: iso(-7), updatedAt: iso(-7),
    document: { fileName: 'inv-fe-2277.pdf', mimeType: 'application/pdf' }, error: null, createdBatchId: null, createdInvoiceId: 'inv-2',
    corrected: null, validation: { engine: 'keyword-rules', report: null, match: invoices[1].matchResult },
    extracted: {
      fieldConfidence: { invoiceNumber: 0.96, invoiceDate: 0.93, supplierName: 0.86, total: 0.9, 'items.0.rawMaterialId': 0.6 },
      illegibleFields: [],
      invoiceNumber: 'INV-FE-2277', invoiceDate: iso(-7).slice(0, 10), supplierId: null, supplierName: 'Fine Excipients', supplierGstin: '27AAECF5678B1Z9', poId: null,
      subtotal: 75424, tax: { total: 13576 }, total: 89000,
      items: [{ description: 'PVP K-30 — 25 KG', rawMaterialId: 'rm-4', quantity: 25, unit: 'KG', unitPrice: 1580, taxPct: 18, amount: 39500 }],
    },
  },
];

export const notifications: any[] = [
  { id: 'n-1', type: 'LOW_STOCK', severity: 'WARNING', title: 'PVP K-30 below reorder level', message: 'Usable stock 12.5 KG is below the reorder level of 40 KG.', link: '/raw-materials/rm-4', createdAt: iso(-1), readAt: null },
  { id: 'n-2', type: 'EXPIRY', severity: 'CRITICAL', title: 'Lot LOT-2412-002 expired', message: '9.2 KG of Starch (Maize) IP expired 6 days ago. Write it off or extend per QC.', link: '/expiry', createdAt: iso(-6), readAt: null },
  { id: 'n-3', type: 'QC_RESULT', severity: 'INFO', title: 'QC sample finalised', message: 'QCR-2503-001 passed — lot LOT-2503-001 is ready to move out of quarantine.', link: '/qc/qc-3', createdAt: iso(-1, 14, 0), readAt: iso(-1, 18, 0) },
  { id: 'n-4', type: 'BATCH_RELEASE', severity: 'SUCCESS', title: 'Batch B2503-001 released', message: 'QC released 294,510 TAB of Paracetamol 500 mg.', link: '/batches/bat-1', createdAt: iso(-35), readAt: iso(-34) },
];

export const auditLogs: any[] = [
  { id: 'al-1', createdAt: iso(-1, 9, 12), userEmail: 'purchase@pharma.local', userRole: 'PURCHASE_MANAGER', action: 'CREATE', entity: 'PurchaseOrder', entityId: 'po-2', ip: '10.0.4.21', before: null, after: { poNumber: 'PO-2504-002', status: 'DRAFT', total: 101500 } },
  { id: 'al-2', createdAt: iso(-2, 11, 45), userEmail: 'production@pharma.local', userRole: 'PRODUCTION_MANAGER', action: 'UPDATE', entity: 'Batch', entityId: 'bat-2', ip: '10.0.4.33', before: { status: 'APPROVED' }, after: { status: 'IN_PRODUCTION' } },
  { id: 'al-3', createdAt: iso(-2, 16, 3), userEmail: 'qc@pharma.local', userRole: 'QC_MANAGER', action: 'CREATE', entity: 'QcSample', entityId: 'qc-4', ip: '10.0.4.8', before: null, after: { sampleNumber: 'QCR-2504-002', status: 'PENDING' } },
  { id: 'al-4', createdAt: iso(-3, 10, 30), userEmail: 'admin@pharma.local', userRole: 'SUPER_ADMIN', action: 'LOGIN', entity: 'User', entityId: 'u-admin', ip: '10.0.4.2', before: null, after: { method: 'password' } },
  { id: 'al-5', createdAt: iso(-35, 15, 20), userEmail: 'qc@pharma.local', userRole: 'QC_MANAGER', action: 'UPDATE', entity: 'Batch', entityId: 'bat-1', ip: '10.0.4.8', before: { status: 'QC_REVIEW' }, after: { status: 'RELEASED' } },
];

export const transferOrders: any[] = [
  { id: 'to-1', trfNumber: 'TRF-2503-001', from: warehouses[0], to: warehouses[3], status: 'COMPLETED', createdAt: iso(-40), items: [{ id: 'toi-1', rawMaterialLot: { lotNumber: 'LOT-2502-009' }, quantity: 20 }] },
];

export const counts: any[] = [
  {
    id: 'cnt-1', countNumber: 'CNT-2503-001', warehouse: warehouses[0], status: 'OPEN', createdAt: iso(-1), _count: { items: 3 },
    items: [
      { id: 'ci-1', rawMaterial: { name: 'Paracetamol IP', uom: 'KG' }, systemQty: 300.5, countedQty: null },
      { id: 'ci-2', rawMaterial: { name: 'Starch (Maize) IP', uom: 'KG' }, systemQty: 95.2, countedQty: null },
      { id: 'ci-3', rawMaterial: { name: 'Opadry White Coating', uom: 'KG' }, systemQty: 21.8, countedQty: null },
    ],
  },
];

export const workOrders: any[] = [
  { id: 'wo-1', woNumber: 'WO-2503-002', product: products[0], quantity: 300000, plannedStart: iso(-2), plannedEnd: iso(2), shift: { name: 'General', startTime: '08:00', endTime: '20:00' }, lineName: 'Tablet Line 1', operators: [{ user: { name: 'Amit Bhosale' } }], progressPct: 60, status: 'IN_PROGRESS', batch: batches[1] },
  { id: 'wo-2', woNumber: 'WO-2504-001', product: products[2], quantity: 50000, plannedStart: iso(3), plannedEnd: iso(6), shift: { name: 'Day', startTime: '09:00', endTime: '17:00' }, lineName: 'Sachet Line', operators: [], progressPct: 0, status: 'SCHEDULED', batch: null },
];

export const shifts: any[] = [
  { id: 'sh-1', name: 'General', startTime: '08:00', endTime: '20:00' },
  { id: 'sh-2', name: 'Day', startTime: '09:00', endTime: '17:00' },
  { id: 'sh-3', name: 'Night', startTime: '20:00', endTime: '08:00' },
];

export const productionPlans: any[] = [
  { id: 'pp-1', planNumber: 'PP-2504-001', periodStart: iso(-3), periodEnd: iso(27), status: 'APPROVED', items: [{ id: 'ppi-1', product: products[0], plannedQty: 900000 }, { id: 'ppi-2', product: products[2], plannedQty: 100000 }] },
];

export const recalls: any[] = [
  { id: 'rc-1', recallNumber: 'RC-2502-001', batch: batches[0], classification: 'CLASS_III', reason: 'Complaint of damaged blister foils from one distributor.', quantityDispatched: 24000, quantityRecovered: 500, status: 'IN_PROGRESS' },
];

// ---------------------------------------------------------------- aggregates
const monthsBack = (n: number) => {
  const out: string[] = [];
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(m.toLocaleString('en-GB', { month: 'short' }));
  }
  return out;
};
const MONTHS = monthsBack(6);

export const dashboard = {
  kpis: {
    inventoryValue: 486_400, finishedGoodsUnits: 289_000, lowStockCount: 3, nearExpiryLots: 2, expiredLots: 1,
    pendingQcSamples: 2, avgYieldPct: 98.5, batchesThisMonth: 2, openPurchaseOrders: 2,
  },
  purchaseVsConsumption: MONTHS.map((month, i) => ({ month, purchase: [420000, 510000, 395000, 542640, 210000, 89000][i], consumption: [380000, 462000, 410000, 498000, 232000, 51200][i] })),
  manufacturingCost: MONTHS.map((month, i) => ({ month, cost: [265000, 268400, 261200, 265400, 266100, null][i], avgYield: [97.8, 98.2, 98.0, 98.17, 98.92, null][i] })),
  rawMaterialStatus: [{ state: 'OK', count: 4 }, { state: 'REORDER', count: 2 }, { state: 'CRITICAL', count: 1 }, { state: 'OUT_OF_STOCK', count: 1 }],
  batchStatus: [{ status: 'DRAFT', count: 1 }, { status: 'APPROVED', count: 0 }, { status: 'IN_PRODUCTION', count: 1 }, { status: 'QC_REVIEW', count: 1 }, { status: 'RELEASED', count: 1 }],
  lowStock: [
    { id: 'rm-4', code: 'RM-PVP', name: 'PVP K-30', usable: 12.5, uom: 'KG', min: 20, state: 'CRITICAL' },
    { id: 'rm-2', code: 'RM-STARCH', name: 'Starch (Maize) IP', usable: 86, uom: 'KG', min: 100, state: 'REORDER' },
    { id: 'rm-7', code: 'RM-ALU', name: 'Aluminium Foil', usable: 0, uom: 'KG', min: 30, state: 'OUT_OF_STOCK' },
  ],
  recentBatches: batches.map((b) => ({ id: b.id, batchNumber: b.batchNumber, product: b.product.name, status: b.status, yieldPct: b.yieldPct })),
  finishedGoods: [{ product: 'Paracetamol 500 mg', quantity: 289000 }],
  topConsumedMaterials: [
    { name: 'Paracetamol IP', value: 512_000 }, { name: 'Starch (Maize) IP', value: 46_800 },
    { name: 'Opadry White Coating', value: 44_100 }, { name: 'PVC Foil (Blister)', value: 28_400 }, { name: 'Magnesium Stearate', value: 9_100 },
  ],
};

export const analytics = {
  totals: { orderNow: 2, shortfalls: 1, valueAtRisk: 4_140, suppliersHighRisk: 0 },
  materials: [
    { rawMaterialId: 'rm-1', code: 'RM-PARA', name: 'Paracetamol IP', uom: 'KG', onHand: 472.5, daysOfCover: 31, leadTimeDays: 7, action: 'OK', currentReorderLevel: 300, recommendedReorderLevel: 210, safetyStock: 62, history: MONTHS.map((month, i) => ({ month, qty: [148, 152, 141, 158, 149, 68][i] })), forecast: [{ month: 'Next', qty: 152, low: 138, high: 166 }, { month: '+2', qty: 155, low: 134, high: 176 }, { month: '+3', qty: 151, low: 128, high: 174 }] },
    { rawMaterialId: 'rm-2', code: 'RM-STARCH', name: 'Starch (Maize) IP', uom: 'KG', onHand: 86, daysOfCover: 12, leadTimeDays: 10, action: 'ORDER_NOW', currentReorderLevel: 200, recommendedReorderLevel: 155, safetyStock: 41, history: MONTHS.map((month, i) => ({ month, qty: [24, 22, 25, 24, 23, 11][i] })), forecast: [{ month: 'Next', qty: 24, low: 20, high: 28 }, { month: '+2', qty: 25, low: 20, high: 30 }, { month: '+3', qty: 24, low: 19, high: 29 }] },
    { rawMaterialId: 'rm-4', code: 'RM-PVP', name: 'PVP K-30', uom: 'KG', onHand: 12.5, daysOfCover: 9, leadTimeDays: 14, action: 'ORDER_NOW', currentReorderLevel: 40, recommendedReorderLevel: 18, safetyStock: 5.2, history: MONTHS.map((month, i) => ({ month, qty: [4.6, 4.5, 4.7, 4.6, 4.6, 2.2][i] })), forecast: [{ month: 'Next', qty: 4.7, low: 3.9, high: 5.5 }, { month: '+2', qty: 4.6, low: 3.7, high: 5.5 }, { month: '+3', qty: 4.8, low: 3.8, high: 5.8 }] },
  ],
  productionNeeds: { openWorkOrders: 2, materials: [{ code: 'RM-ALU', name: 'Aluminium Foil', uom: 'KG', required: 60, onHand: 0, onOrder: 0, shortfall: 60 }] },
  expiryRisk: [{ lotId: 'lot-4', material: 'PVP K-30', lotNumber: 'LOT-2502-004', expiryDate: iso(75), daysLeft: 75, onHand: 12.5, uom: 'KG', projectedUnused: 3.1, riskPct: 25, valueAtRisk: 4_464 }, { lotId: 'lot-8', material: 'Starch (Maize) IP', lotNumber: 'LOT-2412-002', expiryDate: iso(-6), daysLeft: 0, onHand: 9.2, uom: 'KG', projectedUnused: 9.2, riskPct: 100, valueAtRisk: 828 }],
  suppliers: [
    { supplierId: 'sup-1', name: 'Gujarat Pharma Chem', deliveries: 9, grade: 'A', score: 93, onTimePct: 96, fillRatePct: 99, qualityPct: 98, priceStabilityPct: 90, risk: 'LOW' },
    { supplierId: 'sup-2', name: 'Fine Excipients Pvt Ltd', deliveries: 6, grade: 'B', score: 81, onTimePct: 83, fillRatePct: 95, qualityPct: 96, priceStabilityPct: 74, risk: 'MEDIUM' },
    { supplierId: 'sup-3', name: 'MediPack Industries', deliveries: 4, grade: 'B', score: 78, onTimePct: 75, fillRatePct: 92, qualityPct: 94, priceStabilityPct: 88, risk: 'MEDIUM' },
    { supplierId: 'sup-4', name: 'Deccan Solvents', deliveries: 2, grade: 'C', score: 62, onTimePct: 50, fillRatePct: 88, qualityPct: 90, priceStabilityPct: 70, risk: 'HIGH' },
  ],
};

export const expirySummary = {
  summary: { rawMaterialNearExpiry: 1, rawMaterialExpired: 1, finishedGoodsNearExpiry: 0, finishedGoodsExpired: 0 },
  rawMaterialNearExpiry: [{ id: 'lot-4', rawMaterial: { name: 'PVP K-30' }, lotNumber: 'LOT-2502-004', availableQty: 12.5, expiryDate: iso(75), daysLeft: 75, status: 'APPROVED' }],
  rawMaterialExpired: [{ id: 'lot-8', rawMaterial: { name: 'Starch (Maize) IP' }, lotNumber: 'LOT-2412-002', availableQty: 9.2, expiryDate: iso(-6), status: 'EXPIRED' }],
  finishedGoodsNearExpiry: [], finishedGoodsExpired: [],
};

export const reportsCatalog: Record<string, { title: string; columns: { key: string; label: string }[]; rows: any[] }> = {
  inventory: {
    title: 'Inventory report', columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Material' }, { key: 'usable', label: 'Usable' }, { key: 'quarantine', label: 'Quarantine' }, { key: 'uom', label: 'UOM' }, { key: 'value', label: 'Stock value (₹)' }],
    rows: rawMaterials.map((m) => ({ code: m.code, name: m.name, usable: m.usableStock, quarantine: m.quarantineStock, uom: m.uom, value: Math.round((Number(m.usableStock) + Number(m.quarantineStock)) * Number(m.purchasePrice)) })),
  },
  'stock-ledger': {
    title: 'Stock ledger', columns: [{ key: 'date', label: 'Date' }, { key: 'type', label: 'Type' }, { key: 'lot', label: 'Lot' }, { key: 'qty', label: 'Qty' }, { key: 'balance', label: 'Balance' }],
    rows: [
      { date: iso(-95), type: 'RECEIPT', lot: 'LOT-2501-001', qty: 300, balance: 300 },
      { date: iso(-60), type: 'CONSUMPTION', lot: 'LOT-2501-001', qty: -151.5, balance: 148.5 },
      { date: iso(-2), type: 'CONSUMPTION', lot: 'LOT-2501-001', qty: -151.5, balance: -3 },
    ],
  },
  consumption: {
    title: 'Consumption report', columns: [{ key: 'batch', label: 'Batch' }, { key: 'material', label: 'Material' }, { key: 'lot', label: 'Lot' }, { key: 'qty', label: 'Qty (KG)' }],
    rows: [{ batch: 'B2503-001', material: 'Paracetamol IP', lot: 'LOT-2501-001', qty: 151.5 }, { batch: 'B2503-001', material: 'Starch (Maize) IP', lot: 'LOT-2501-002', qty: 22.95 }],
  },
  production: {
    title: 'Production report', columns: [{ key: 'batch', label: 'Batch' }, { key: 'product', label: 'Product' }, { key: 'size', label: 'Size' }, { key: 'yield', label: 'Yield %' }, { key: 'status', label: 'Status' }],
    rows: batches.map((b) => ({ batch: b.batchNumber, product: b.product.name, size: `${b.batchSize} ${b.batchUnit}`, yield: b.yieldPct ?? '', status: b.status })),
  },
  batches: {
    title: 'Batch register', columns: [{ key: 'batch', label: 'Batch' }, { key: 'product', label: 'Product' }, { key: 'mfg', label: 'Mfg' }, { key: 'expiry', label: 'Expiry' }, { key: 'status', label: 'Status' }],
    rows: batches.map((b) => ({ batch: b.batchNumber, product: b.product.name, mfg: b.mfgDate.slice(0, 10), expiry: b.expiryDate.slice(0, 10), status: b.status })),
  },
  cost: {
    title: 'Cost report', columns: [{ key: 'batch', label: 'Batch' }, { key: 'cost', label: 'Material cost (₹)' }, { key: 'perUnit', label: 'Cost / unit (₹)' }],
    rows: batches.filter((b) => b.materialCost).map((b) => ({ batch: b.batchNumber, cost: b.materialCost, perUnit: b.costPerUnit })),
  },
  expiry: {
    title: 'Expiry report', columns: [{ key: 'lot', label: 'Lot / Batch' }, { key: 'item', label: 'Item' }, { key: 'expiry', label: 'Expiry' }, { key: 'qty', label: 'Qty' }, { key: 'status', label: 'Status' }],
    rows: materialLots.map((l) => ({ lot: l.lotNumber, item: rawMaterials.find((m) => m.id === l.rawMaterialId)?.name ?? '', expiry: l.expiryDate.slice(0, 10), qty: l.availableQty, status: l.status })),
  },
  suppliers: {
    title: 'Supplier report', columns: [{ key: 'name', label: 'Supplier' }, { key: 'deliveries', label: 'Deliveries' }, { key: 'ontime', label: 'On-time %' }, { key: 'score', label: 'Score' }, { key: 'risk', label: 'Risk' }],
    rows: analytics.suppliers.map((s) => ({ name: s.name, deliveries: s.deliveries, ontime: s.onTimePct, score: s.score, risk: s.risk })),
  },
  audit: {
    title: 'Audit report', columns: [{ key: 'when', label: 'When' }, { key: 'user', label: 'User' }, { key: 'action', label: 'Action' }, { key: 'entity', label: 'Entity' }],
    rows: auditLogs.map((a) => ({ when: a.createdAt, user: a.userEmail, action: a.action, entity: a.entity })),
  },
};

/** Stock ledger rows as served for /inventory/ledger. */
export const ledger = [
  { id: 'sl-1', createdAt: iso(-95), type: 'RECEIPT', materialLot: { rawMaterial: { name: 'Paracetamol IP' }, lotNumber: 'LOT-2501-001' }, fgLot: null, quantity: 300, balanceAfter: 300, reference: 'GRN-2503-001', reason: 'Supplier delivery' },
  { id: 'sl-2', createdAt: iso(-60), type: 'CONSUMPTION', materialLot: { rawMaterial: { name: 'Paracetamol IP' }, lotNumber: 'LOT-2501-001' }, fgLot: null, quantity: -151.5, balanceAfter: 148.5, reference: 'B2503-001', reason: 'Batch consumption' },
  { id: 'sl-3', createdAt: iso(-12), type: 'PRODUCTION_OUTPUT', materialLot: null, fgLot: { product: { name: 'Paracetamol 500 mg' }, batch: { batchNumber: 'B2503-001' } }, quantity: 294510, balanceAfter: 294510, reference: 'B2503-001', reason: 'QC release' },
  { id: 'sl-4', createdAt: iso(-12), type: 'DISPATCH', materialLot: null, fgLot: { product: { name: 'Paracetamol 500 mg' }, batch: { batchNumber: 'B2503-001' } }, quantity: -24000, balanceAfter: 270510, reference: 'DSP-2503-001', reason: 'City Chemist Chain' },
];
