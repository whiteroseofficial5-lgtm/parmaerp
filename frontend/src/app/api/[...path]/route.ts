/**
 * CATCH-ALL API ROUTE
 *
 * Two modes:
 *   • DEMO_MODE (default unless `DEMO_MODE=false` is set) — every endpoint the web app
 *     calls is served from the in-memory dataset in `@/lib/demo-data`. No backend, no
 *     database. This is what lets the app run as a shareable demo link.
 *   • Real backend — when `DEMO_MODE=false` is set, requests are forwarded verbatim to
 *     `BACKEND_URL` (the Express/Prisma API), so the original full-stack setup still works.
 */
import { NextRequest, NextResponse } from 'next/server';
import * as demo from '@/lib/demo-data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEMO_ENABLED = process.env.DEMO_MODE !== 'false';
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:4000';

// ------------------------------------------------------------------ helpers
let seq = 5000;
const nid = (p: string) => `${p}-${++seq}`;
const nowIso = () => new Date().toISOString();
const daysUntil = (v?: string | null) => (v ? Math.round((new Date(v).getTime() - Date.now()) / 86_400_000) : null);

const RESERVED = new Set(['page', 'pageSize', 'q', 'from', 'to', 'days', 'format', 'inline', 'save', 'coa', 'hours', 'batchSize', 'download']);

function matchFilter(row: any, key: string, value: string): boolean {
  if (key === 'state') return String(row.stockState ?? row.state ?? '') === value;
  if (key === 'isApproved') return String(!!row.isApproved) === value;
  if (key === 'expiringInDays') { const d = daysUntil(row.expiryDate); return d !== null && d <= Number(value); }
  const rv = key.split('.').reduce((a: any, k: string) => a?.[k], row);
  return String(rv ?? '') === value;
}

function selectRows<T extends Record<string, any>>(rows: T[], sp: URLSearchParams, opts: { search?: (r: T) => string; sort?: (a: T, b: T) => number } = {}): T[] {
  let out = rows;
  const q = sp.get('q');
  if (q) { const t = q.toLowerCase(); out = out.filter((r) => (opts.search ? opts.search(r) : JSON.stringify(r)).toLowerCase().includes(t)); }
  for (const [k, v] of sp.entries()) { if (RESERVED.has(k) || v === '') continue; out = out.filter((r) => matchFilter(r, k, v)); }
  return opts.sort ? [...out].sort(opts.sort) : out;
}

function paginate<T>(rows: T[], sp: URLSearchParams) {
  const page = Math.max(1, Number(sp.get('page') ?? 1) || 1);
  const pageSize = Math.max(1, Number(sp.get('pageSize') ?? 25) || 25);
  return { data: rows.slice((page - 1) * pageSize, page * pageSize), meta: { total: rows.length, pages: Math.max(1, Math.ceil(rows.length / pageSize)) } };
}

const pick = (obj: any, keys: string[]): any => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));

// ------------------------------------------------------------------ views (join relations)
const rm = (id?: string | null) => demo.rawMaterials.find((m) => m.id === id) ?? null;
const wh = (id?: string | null) => demo.warehouses.find((w) => w.id === id) ?? null;
const bin = (id?: string | null) => demo.bins.find((b) => b.id === id) ?? null;

const materialView = (m: any) => ({ ...m, defaultSupplier: demo.suppliers.find((s) => s.id === m.defaultSupplierId) ?? null });
const lotView = (l: any) => {
  const m = rm(l.rawMaterialId);
  return { ...l, rawMaterialId: l.rawMaterialId, rawMaterial: m ? { id: m.id, code: m.code, name: m.name, uom: m.uom } : null, warehouse: wh(l.warehouseId), bin: bin(l.binId) };
};
const batchView = (b: any) => ({ ...b, product: b.product ?? demo.products.find((p) => p.id === b.productId) ?? null });
const fgView = (f: any) => ({ ...f, product: f.product ?? demo.products.find((p) => p.id === f.productId) ?? null, batch: f.batch ?? demo.batches.find((b) => b.id === f.batchId) ?? null, warehouse: f.warehouse ?? wh(f.warehouseId), bin: f.bin ?? bin(f.binId) });
const poView = (p: any) => ({ ...p, supplier: demo.suppliers.find((s) => s.id === p.supplierId) ?? null, items: (p.items ?? []).map((i: any) => ({ ...i, rawMaterial: i.rawMaterial ?? rm(i.rawMaterialId) })) });
const grnView = (g: any) => ({ ...g, supplier: demo.suppliers.find((s) => s.id === g.supplierId) ?? null, po: demo.purchaseOrders.find((p) => p.id === g.poId) ?? null });
const invoiceView = (i: any) => ({ ...i, supplier: demo.suppliers.find((s) => s.id === i.supplierId) ?? null, items: (i.items ?? []).map((x: any) => ({ ...x, rawMaterial: x.rawMaterialId ? { code: rm(x.rawMaterialId)?.code ?? '' } : null })) });

// ------------------------------------------------------------------ documents
function pdf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => '\\' + c);
  let content = '';
  let y = 800;
  for (const l of lines) { content += `BT /F1 11 Tf 50 ${y} Td (${esc(l.slice(0, 110))}) Tj ET\n`; y -= 16; }
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { out += `${String(o).padStart(10, '0')} 00000 n \n`; });
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}
const pdfRes = (title: string, lines: string[]) => new NextResponse(pdf([title, '', ...lines]) as any, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline' } });

function qrSvg(text: string, size = 160) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  const n = 21, cell = size / n;
  let rects = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    const finder = (r < 7 && c < 7) || (r < 7 && c > n - 8) || (r > n - 8 && c < 7);
    const on = finder ? ((r % 6 === 0 || c % 6 === 0) || (r > 1 && r < 5 && c > 1 && c < 5)) : (h >>> 0) % 2 === 0;
    if (on) rects += `<rect x="${(c * cell).toFixed(1)}" y="${(r * cell).toFixed(1)}" width="${cell.toFixed(1)}" height="${cell.toFixed(1)}" fill="#111"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size + 22}" viewBox="0 0 ${size} ${size + 22}"><rect width="100%" height="100%" fill="#fff"/>${rects}<text x="${size / 2}" y="${size + 16}" font-family="monospace" font-size="11" text-anchor="middle" fill="#111">${text.slice(0, 26)}</text></svg>`;
  return new NextResponse(svg, { headers: { 'Content-Type': 'image/svg+xml' } });
}

// ------------------------------------------------------------------ stock moves
function addLedger(entry: any) {
  demo.ledger.unshift({ id: nid('sl'), createdAt: nowIso(), materialLot: null, fgLot: null, balanceAfter: 0, reference: '—', reason: '', ...entry });
}
function addAudit(action: string, entity: string, entityId: string, before: any, after: any, user: any) {
  demo.auditLogs.unshift({ id: nid('al'), createdAt: nowIso(), userEmail: user?.email ?? 'system', userRole: user?.role ?? 'SYSTEM', action, entity, entityId, ip: '10.0.4.10', before, after });
}
function addNotification(n: any) {
  demo.notifications.unshift({ id: nid('n'), createdAt: nowIso(), readAt: null, ...n });
}
function consumeFefo(rawMaterialId: string, quantity: number, reference: string) {
  let left = quantity;
  const lots = demo.materialLots
    .filter((l) => l.rawMaterialId === rawMaterialId && l.status === 'APPROVED' && l.availableQty > 0)
    .sort((a, b) => +new Date(a.expiryDate) - +new Date(b.expiryDate));
  const used: any[] = [];
  for (const lot of lots) {
    if (left <= 0) break;
    const take = Math.min(lot.availableQty, left);
    lot.availableQty = +(lot.availableQty - take).toFixed(3);
    left = +(left - take).toFixed(3);
    used.push({ lot, take });
    addLedger({ type: 'CONSUMPTION', materialLot: { rawMaterial: { name: rm(rawMaterialId)?.name ?? '' }, lotNumber: lot.lotNumber }, quantity: -take, balanceAfter: lot.availableQty, reference, reason: 'Batch consumption (FEFO)' });
  }
  return used;
}

// ------------------------------------------------------------------ auth
const publicUser = (u: any) => ({ id: u.id, email: u.email, name: u.name, role: u.role, permissions: demo.ROLE_PERMISSIONS[u.role] ?? [] });
const tokenFor = (id: string, kind: 'access' | 'refresh') => `demo-${kind}.${id}.${Date.now()}`;
function userFromToken(token?: string | null) {
  if (!token) return null;
  const id = token.replace(/^Bearer\s+/i, '').split('.')[1];
  return demo.DEMO_USERS.find((u) => u.id === id) ?? null;
}

// ------------------------------------------------------------------ router
async function handle(req: NextRequest, method: string, seg: string[]): Promise<Response> {
  const sp = req.nextUrl.searchParams;
  const p = seg.join('/');
  const json = (data: any, init?: ResponseInit) => NextResponse.json(data, init);
  const notFound = (msg = 'Not found in demo data') => json({ error: msg }, { status: 404 });
  const readBody = async () => { try { return await req.json(); } catch { return {}; } };

  // ---- unauthenticated
  if (p === 'auth/login' && method === 'POST') {
    const b = await readBody();
    const u = demo.DEMO_USERS.find((x) => x.email.toLowerCase() === String(b.email ?? '').toLowerCase() && x.password === b.password);
    if (!u) return json({ error: 'Invalid credentials' }, { status: 401 });
    addAudit('LOGIN', 'User', u.id, null, { method: 'password' }, u);
    return json({ accessToken: tokenFor(u.id, 'access'), refreshToken: tokenFor(u.id, 'refresh'), user: publicUser(u) });
  }
  if (p === 'auth/refresh' && method === 'POST') {
    const b = await readBody();
    const u = userFromToken(b.refreshToken);
    if (!u) return json({ error: 'Session expired' }, { status: 401 });
    return json({ accessToken: tokenFor(u.id, 'access'), refreshToken: tokenFor(u.id, 'refresh') });
  }
  if (p === 'auth/logout') return json({ ok: true });
  if (p.startsWith('public/trace/')) {
    const bn = decodeURIComponent(seg[2] ?? '');
    const b = demo.batches.find((x) => x.batchNumber.toLowerCase() === bn.toLowerCase()) as any;
    if (!b) return notFound(`No batch matches code ${bn}. This pack may not be genuine — please contact the manufacturer.`);
    const recalls = demo.recalls.filter((r) => r.batch?.id === b.id);
    return json({
      batchNumber: b.batchNumber, product: b.product, mfgDate: b.mfgDate, expiryDate: b.expiryDate, batchSize: b.batchSize, batchUnit: b.batchUnit,
      status: b.status, qcStatus: b.qcStatus, releasedAt: b.releasedAt,
      isExpired: +new Date(b.expiryDate) < Date.now(), recalled: recalls.some((r) => r.status !== 'CLOSED'),
      recalls: recalls.map((r) => ({ reason: r.reason })),
      rawMaterialHistory: (b.materials ?? []).map((m: any) => ({ code: m.rawMaterial?.code ?? '', material: m.rawMaterial?.name ?? '', lots: (m.consumptions ?? []).map((c: any) => ({ lotNumber: c.materialLot?.lotNumber, supplier: c.materialLot?.supplier?.name })) })),
      productionHistory: (b.history ?? []).map((h: any) => ({ toStatus: h.toStatus, createdAt: h.createdAt })),
      qcHistory: (b.qcSamples ?? []).map((q: any) => ({ sampleNumber: q.sampleNumber, type: q.type, status: q.status })),
    });
  }

  // ---- everything below needs a session
  const user = userFromToken(req.headers.get('authorization'));
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  if (p === 'auth/me') return json(publicUser(user));
  if (p === 'health') return json({ ok: true, mode: 'demo' });

  // ================================================== reads
  if (method === 'GET') {
    if (p === 'dashboard') return json(demo.dashboard);
    if (p === 'analytics') return json(demo.analytics);
    if (p === 'analytics/suppliers') return json(demo.analytics.suppliers);
    if (p === 'expiry') return json(demo.expirySummary);
    if (p === 'expiry/recalls') return json(demo.recalls);

    if (p === 'raw-materials') return json(paginate(selectRows(demo.rawMaterials.map(materialView), sp, { search: (r) => `${r.code} ${r.name}`, sort: (a, b) => a.code.localeCompare(b.code) }), sp));
    if (seg[0] === 'raw-materials' && seg.length === 2) {
      const m = demo.rawMaterials.find((x) => x.id === seg[1]);
      if (!m) return notFound();
      return json({
        ...materialView(m),
        lots: demo.materialLots.filter((l) => l.rawMaterialId === m.id).map(lotView),
        prices: [
          { id: 'prc-1', price: m.purchasePrice, effectiveDate: nowIso(), source: 'PO-2503-001', supplier: demo.suppliers[0] },
          { id: 'prc-2', price: +(m.purchasePrice * 0.97).toFixed(2), effectiveDate: new Date(Date.now() - 90 * 864e5).toISOString(), source: 'PO-2412-014', supplier: demo.suppliers[1] },
        ],
        specs: [
          { id: 'spc-1', testName: 'Appearance', method: 'Visual', textSpec: 'White to off-white powder' },
          { id: 'spc-2', testName: 'Assay', method: 'HPLC', lowerLimit: 98, upperLimit: 102, unit: '%' },
          { id: 'spc-3', testName: 'Loss on drying', method: 'Gravimetric', lowerLimit: null, upperLimit: 0.5, unit: '%' },
        ],
      });
    }
    if (p === 'products') return json(paginate(selectRows(demo.products, sp, { search: (r) => `${r.code} ${r.name}` }), sp));
    if (p === 'suppliers') return json(paginate(selectRows(demo.suppliers, sp, { search: (r) => `${r.name} ${r.code} ${r.gstin}` }), sp));
    if (seg[0] === 'suppliers' && seg[2] === 'performance') {
      const sid = seg[1];
      return json({
        priceHistory: demo.rawMaterials.slice(0, 5).map((m, i) => ({ id: `ph-${i}`, rawMaterial: { name: m.name }, price: m.purchasePrice, effectiveDate: new Date(Date.now() - (i + 1) * 21 * 864e5).toISOString(), supplier: demo.suppliers.find((s) => s.id === sid) })),
        purchaseOrders: demo.purchaseOrders.filter((x) => x.supplierId === sid).map((x) => ({ id: x.id, poNumber: x.poNumber, status: x.status, total: x.total, orderDate: x.orderDate })),
      });
    }
    if (p === 'warehouses') return json(paginate(selectRows(demo.warehouses, sp, { search: (r) => `${r.code} ${r.name}` }), sp));
    if (p === 'racks') return json(paginate(selectRows(demo.racks, sp), sp));
    if (p === 'bins') return json(paginate(selectRows(demo.bins, sp), sp));

    if (p === 'inventory/lots') return json(paginate(selectRows(demo.materialLots.map(lotView), sp, { search: (r) => `${r.lotNumber} ${r.rawMaterial?.code} ${r.rawMaterial?.name}` }), sp));
    if (p === 'inventory/ledger') return json(paginate(selectRows(demo.ledger, sp), sp));
    if (p === 'inventory/transfer-orders') return json(selectRows(demo.transferOrders, sp));
    if (p === 'inventory/counts') return json(selectRows(demo.counts, sp));
    if (seg[0] === 'inventory' && seg[1] === 'counts' && seg.length === 3) { const c = demo.counts.find((x) => x.id === seg[2]); return c ? json(c) : notFound(); }

    if (p === 'formulas') return json(paginate(selectRows(demo.formulas, sp, { search: (r) => `${r.product?.code} ${r.product?.name}` }), sp));
    if (p === 'formulas/diff') {
      const a = demo.formulas.find((f) => f.id === sp.get('from')), b = demo.formulas.find((f) => f.id === sp.get('to'));
      if (!a || !b) return notFound();
      const changes: any[] = [];
      for (const it of [...a.items, ...b.items]) {
        const inA = a.items.find((x: any) => x.rawMaterialId === it.rawMaterialId), inB = b.items.find((x: any) => x.rawMaterialId === it.rawMaterialId);
        if (inA && !inB) changes.push({ type: 'REMOVED', material: rm(it.rawMaterialId)?.name ?? it.rawMaterialId, from: `${inA.quantity} ${inA.unit}`, to: null });
        else if (!inA && inB) changes.push({ type: 'ADDED', material: rm(it.rawMaterialId)?.name ?? it.rawMaterialId, from: null, to: `${inB.quantity} ${inB.unit}` });
        else if (inA && inB && inA.quantity !== inB.quantity) changes.push({ type: 'CHANGED', material: rm(it.rawMaterialId)?.name ?? it.rawMaterialId, from: `${inA.quantity} ${inA.unit}`, to: `${inB.quantity} ${inB.unit}` });
      }
      const uniq = changes.filter((c, i) => changes.findIndex((x) => x.material === c.material && x.type === c.type) === i);
      return json({ from: a.version, to: b.version, changes: uniq });
    }
    if (seg[0] === 'formulas' && seg[2] === 'cost') {
      const f = demo.formulas.find((x) => x.id === seg[1]);
      if (!f) return notFound();
      const size = Number(sp.get('batchSize') ?? f.baseBatchSize) || f.baseBatchSize;
      const scale = size / f.baseBatchSize;
      const lines = f.items.filter((i: any) => rm(i.rawMaterialId)).map((i: any) => {
        const m = rm(i.rawMaterialId)!;
        const required = +(i.quantity * (1 + i.wastagePct / 100) * scale).toFixed(3);
        const available = Number(m.usableStock);
        return { rawMaterialId: m.id, code: m.code, name: m.name, stage: i.stage, baseQty: i.quantity, formulaUnit: i.unit, wastagePct: i.wastagePct, requiredQty: required, requiredInStockUom: required, stockUom: m.uom, unitCost: m.purchasePrice, lineCost: +(required * m.purchasePrice).toFixed(2), availableStock: available, shortage: Math.max(0, +(required - available).toFixed(3)) };
      });
      const materialCost = +lines.reduce((s: number, l: any) => s + l.lineCost, 0).toFixed(2);
      const expectedOutput = +(size * (f.expectedYieldPct / 100)).toFixed(0);
      return json({ materialCost, costPerUnit: +(materialCost / Math.max(1, expectedOutput)).toFixed(4), expectedOutput, batchUnit: f.baseBatchUnit, expectedYieldPct: f.expectedYieldPct, expectedWastagePct: f.expectedWastagePct, canManufacture: lines.every((l: any) => l.shortage === 0), lines });
    }
    if (seg[0] === 'formulas' && seg.length === 2) {
      const f = demo.formulas.find((x) => x.id === seg[1]);
      return f ? json(f) : notFound();
    }

    if (p === 'batches') return json(paginate(selectRows(demo.batches.map(batchView), sp, { search: (r) => `${r.batchNumber} ${r.product?.name}` }), sp));
    if (seg[0] === 'batches' && seg[2] === 'qr') { const b = demo.batches.find((x) => x.id === seg[1]); return qrSvg(b ? b.batchNumber : 'UNKNOWN'); }
    if (seg[0] === 'batches' && seg[2] === 'validate') return json(validateBatch(demo.batches.find((x) => x.id === seg[1])));
    if (seg[0] === 'batches' && seg[2] === 'pdf') { const b = demo.batches.find((x) => x.id === seg[1]); return pdfRes(`${seg[3] === 'bpr' ? 'Batch packaging record' : 'Batch manufacturing record'} — ${b?.batchNumber ?? ''}`, [`Product: ${b?.product?.name ?? ''}`, `Batch size: ${b?.batchSize} ${b?.batchUnit}`, `Mfg: ${b?.mfgDate?.slice(0, 10)}   Expiry: ${b?.expiryDate?.slice(0, 10)}`, `Status: ${b?.status}   QC: ${b?.qcStatus}`, '', 'Generated from demo data — connect the backend for signed PDFs.']); }
    if (seg[0] === 'batches' && seg.length === 2) { const b = demo.batches.find((x) => x.id === seg[1]); return b ? json(batchView(b)) : notFound(); }

    if (p === 'qc/samples') return json(paginate(selectRows(demo.qcSamples, sp, { search: (r) => r.sampleNumber, sort: (a, b) => +new Date(b.collectedAt) - +new Date(a.collectedAt) }), sp));
    if (seg[0] === 'qc' && seg[1] === 'samples' && seg[3] === 'specs') {
      return json([
        { id: 's-1', testName: 'Description', method: 'Visual', textSpec: 'White to off-white powder', lowerLimit: null, upperLimit: null, unit: null },
        { id: 's-2', testName: 'Assay', method: 'HPLC', textSpec: null, lowerLimit: 98, upperLimit: 102, unit: '%' },
        { id: 's-3', testName: 'Loss on drying', method: 'Gravimetric', textSpec: null, lowerLimit: null, upperLimit: 0.5, unit: '%' },
      ]);
    }
    if (seg[0] === 'qc' && seg[1] === 'samples' && seg[3] === 'report') { const s = demo.qcSamples.find((x) => x.id === seg[2]); return pdfRes(`${s?.coa ? 'Certificate of analysis' : 'Test report'} — ${s?.sampleNumber ?? ''}`, [`Type: ${s?.type}   Status: ${s?.status}`, `Collected: ${s?.collectedAt?.slice(0, 10)}`, ...(s?.results ?? []).map((r: any) => `${r.parameter}: ${r.resultValue} ${r.unit ?? ''} (${r.specification}) ${r.passed ? 'PASS' : 'FAIL'}`)]); }
    if (seg[0] === 'qc' && seg[1] === 'samples' && seg.length === 3) { const s = demo.qcSamples.find((x) => x.id === seg[2]); return s ? json({ remarks: null, ...s }) : notFound(); }

    if (p === 'purchase/orders') return json(paginate(selectRows(demo.purchaseOrders.map(poView), sp, { search: (r) => `${r.poNumber} ${r.supplier?.name}` }), sp));
    if (seg[0] === 'purchase' && seg[1] === 'orders' && seg[3] === 'pdf') { const po = demo.purchaseOrders.find((x) => x.id === seg[2]); return pdfRes(`Purchase order ${po?.poNumber ?? ''}`, [`Supplier: ${po?.supplier?.name ?? ''}`, `Order date: ${po?.orderDate?.slice(0, 10)}`, `Status: ${po?.status}`, ...(po?.items ?? []).map((i: any) => `${rm(i.rawMaterialId)?.name ?? ''}: ${i.quantity} @ ${i.unitPrice}`)]); }
    if (seg[0] === 'purchase' && seg[1] === 'orders' && seg.length === 3) { const po = demo.purchaseOrders.find((x) => x.id === seg[2]); return po ? json(poView(po)) : notFound(); }
    if (p === 'purchase/grn') return json(paginate(selectRows(demo.grns.map(grnView), sp), sp));
    if (seg[0] === 'purchase' && seg[1] === 'grn' && seg[3] === 'pdf') { const g = demo.grns.find((x) => x.id === seg[2]); return pdfRes(`Goods receipt ${g?.grnNumber ?? ''}`, [`Supplier: ${g?.supplier?.name ?? ''}`, `Received: ${g?.receivedAt?.slice(0, 10)}`, ...(g?.items ?? []).map((i: any) => `${i.rawMaterial?.name ?? ''}: ${i.quantity} (lot ${i.lotNumber})`)]); }
    if (p === 'purchase/invoices') return json(paginate(selectRows(demo.invoices.map(invoiceView), sp, { search: (r) => `${r.invoiceNumber} ${r.supplier?.name}` }), sp));
    if (seg[0] === 'purchase' && seg[1] === 'invoices' && seg.length === 3) { const i = demo.invoices.find((x) => x.id === seg[2]); return i ? json(invoiceView(i)) : notFound(); }
    if (p === 'purchase/requisitions') return json(selectRows(demo.requisitions, sp));

    if (p === 'finished-goods') return json(paginate(selectRows(demo.fgLots.map(fgView), sp, { search: (r) => `${r.product?.name} ${r.batch?.batchNumber}` }), sp));
    if (p === 'finished-goods/dispatches/all') return json(selectRows(demo.dispatches, sp));

    if (p === 'documents') return json(paginate(selectRows(demo.documents, sp, { search: (r) => `${r.title} ${r.fileName}` }), sp));
    if (seg[0] === 'documents' && seg[2] === 'download') { const d = demo.documents.find((x) => x.id === seg[1]); return pdfRes(`Document — ${d?.title ?? ''}`, [`Type: ${d?.type}   Version: v${d?.version}`, `File: ${d?.fileName}`, 'Demo mode: the original file is not bundled with this preview.']); }

    if (p === 'notifications') return json(paginate(selectRows(demo.notifications, sp), sp));
    if (p === 'notifications/count') return json({ unread: demo.notifications.filter((n) => !n.readAt).length });

    if (p === 'audit') return json(paginate(selectRows(demo.auditLogs, sp, { search: (r) => `${r.userEmail} ${r.entity} ${r.entityId}` }), sp));
    if (p === 'audit/entities') return json([...new Set(demo.auditLogs.map((a) => a.entity)).values()]);

    if (p === 'users') return json(paginate(selectRows(demo.DEMO_USERS.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, isActive: true, lastLoginAt: new Date(Date.now() - 36e5).toISOString() } as any)), sp, { search: (r: any) => `${r.name} ${r.email}` }), sp));
    if (p === 'users/lookup') return json(demo.DEMO_USERS.map((u) => ({ id: u.id, name: u.name })));
    if (p === 'users/roles/matrix') return json(demo.ROLE_PERMISSIONS);

    if (p === 'production/work-orders') return json(paginate(selectRows(demo.workOrders, sp, { search: (r) => `${r.woNumber} ${r.product?.name}` }), sp));
    if (p === 'production/plans') return json(selectRows(demo.productionPlans, sp));
    if (p === 'production/schedule') return json(demo.workOrders.map((w) => pick(w, ['id', 'woNumber', 'product', 'plannedStart', 'plannedEnd', 'status', 'shift'])));
    if (p === 'shifts') return json(demo.shifts);

    if (p === 'ai/status') return json({ engine: 'keyword-rules', model: null });
    if (p === 'ai/jobs') return json(paginate(selectRows(demo.aiJobs, sp), sp));
    if (seg[0] === 'ai' && seg[1] === 'jobs' && seg[3] === 'file') return pdfRes('Original document (demo)', ['The uploaded file is not stored in demo mode.', 'Connect the backend to keep originals alongside extracted data.']);
    if (seg[0] === 'ai' && seg[1] === 'jobs' && seg.length === 3) {
      const j = demo.aiJobs.find((x) => x.id === seg[2]);
      return j ? json({ ...j, corrected: j.corrected ?? j.extracted }) : notFound();
    }

    if (seg[0] === 'reports' && seg.length === 2) {
      const r = demo.reportsCatalog[seg[1]];
      if (!r) return notFound();
      const fmt = sp.get('format');
      if (!fmt) return json(r);
      if (fmt === 'pdf') return pdfRes(r.title, r.rows.slice(0, 30).map((row) => r.columns.map((c) => `${row[c.key] ?? ''}`).join(' | ')));
      const csv = [r.columns.map((c) => `"${c.label}"`).join(','), ...r.rows.map((row) => r.columns.map((c) => `"${row[c.key] ?? ''}"`).join(','))].join('\n');
      return new NextResponse('\uFEFF' + csv, { headers: { 'Content-Type': 'text/csv' } });
    }

    if (seg[0] === 'scan' && seg[1] === 'resolve') {
      const code = decodeURIComponent(sp.get('code') ?? '');
      const parts = code.split('|');
      if (parts[0] === 'LOT' || /^LOT-/.test(code)) {
        const lotNumber = parts[2] ?? code;
        const lot = demo.materialLots.find((l) => l.lotNumber === lotNumber) ?? demo.materialLots[0];
        return json({ type: 'LOT', data: { ...lotView(lot), barcode: lot.barcode ?? code } });
      }
      if (parts[0] === 'BIN') { const b = demo.bins.find((x) => x.code === parts[2] || x.barcode === code) ?? demo.bins[0]; return json({ type: 'BIN', data: { ...b, warehouse: demo.warehouses[0], materialLots: demo.materialLots.slice(0, 2).map(lotView) } }); }
      const b = demo.batches.find((x) => x.batchNumber.toLowerCase() === code.toLowerCase());
      if (b) return json({ type: 'BATCH', data: batchView(b) });
      const m = demo.rawMaterials.find((x) => x.code.toLowerCase() === code.toLowerCase());
      if (m) return json({ type: 'MATERIAL', data: materialView(m) });
      return notFound(`Code ${code} does not resolve to a lot, material, bin or batch.`);
    }
    if (seg[0] === 'scan' && seg[1] === 'label') return qrSvg(decodeURIComponent(sp.get('code') ?? 'DEMO'));

    return notFound(`No demo handler for GET /api/${p}`);
  }

  // ================================================== writes
  const body = await readBody();

  // ---- batches
  if (p === 'batches' && method === 'POST') {
    const product = demo.products.find((x) => x.id === body.productId) ?? demo.products[0];
    const formula = demo.formulas.find((f) => f.productId === product.id && f.status === 'APPROVED') ?? null;
    const b: any = {
      id: nid('bat'), batchNumber: `B-${new Date().getFullYear()}-${String(demo.batches.length + 1).padStart(3, '0')}`, productId: product.id, product, formulaId: formula?.id ?? null, formula,
      status: 'DRAFT', qcStatus: 'PENDING', source: 'SYSTEM', batchSize: Number(body.batchSize) || 100000, batchUnit: product.uom,
      mfgDate: body.mfgDate ?? nowIso(), expiryDate: new Date(Date.now() + product.shelfLifeMonths * 30 * 864e5).toISOString(),
      actualYield: null, yieldPct: null, wastagePct: null, theoreticalYield: Math.round((Number(body.batchSize) || 100000) * (formula?.expectedYieldPct ?? 98) / 100),
      materialCost: null, costPerUnit: null, createdById: user.id, releasedAt: null,
      materials: (formula?.items ?? []).filter((i: any) => i.quantity > 0).map((i: any) => ({ id: nid('bm'), rawMaterial: { code: rm(i.rawMaterialId)?.code ?? '', name: rm(i.rawMaterialId)?.name ?? '' }, requiredQty: i.quantity, issuedQty: null, unit: i.unit, consumptions: [] })),
      qcSamples: [], signatures: [], remarks: body.remarks ?? null,
      history: [{ id: nid('bh'), toStatus: 'DRAFT', createdAt: nowIso(), remarks: body.remarks ?? 'Created from the web app' }],
    };
    demo.batches.unshift(b);
    addAudit('CREATE', 'Batch', b.id, null, { batchNumber: b.batchNumber, status: 'DRAFT' }, user);
    return json(b);
  }
  if (seg[0] === 'batches' && seg[2]) {
    const b = demo.batches.find((x) => x.id === seg[1]) as any;
    if (!b) return notFound();
    const action = seg[2];
    const map: Record<string, string> = { approve: 'APPROVED', start: 'IN_PRODUCTION', complete: 'QC_REVIEW', release: 'RELEASED', reject: 'REJECTED', cancel: 'CANCELLED' };
    if (action in map) {
      const before = b.status;
      b.status = map[action];
      if (action === 'start') {
        for (const m of b.materials) {
          const materialId = findMaterialIdByCode(m.rawMaterial?.code);
          const used = materialId ? consumeFefo(materialId, m.requiredQty, b.batchNumber) : [];
          m.issuedQty = m.requiredQty;
          m.consumptions = used.map((u) => ({ id: nid('bc'), quantity: u.take, materialLot: { lotNumber: u.lot.lotNumber, expiryDate: u.lot.expiryDate, supplier: { name: demo.suppliers[0].name } } }));
        }
      }
      if (action === 'complete') {
        b.actualYield = Number(body.actualYield) || b.theoreticalYield;
        b.yieldPct = +((b.actualYield / Math.max(1, b.batchSize)) * 100).toFixed(2);
        b.wastagePct = +(100 - b.yieldPct).toFixed(2);
        b.qcStatus = 'IN_TESTING';
        const sample = { id: nid('qc'), sampleNumber: `QCF-${new Date().getFullYear()}-${String(seq).slice(-3)}`, type: 'FINISHED_PRODUCT', status: 'PENDING', collectedAt: nowIso(), analystId: 'u-qc', batchId: b.id, batch: { product: b.product, batchNumber: b.batchNumber }, materialLotId: null, materialLot: null, coa: null, _count: { results: 0 }, results: [] };
        demo.qcSamples.unshift(sample);
        b.qcSamples.push(sample);
      }
      if (action === 'release') {
        b.qcStatus = 'PASSED';
        b.releasedAt = nowIso();
        demo.fgLots.unshift({ id: nid('fg'), batchId: b.id, batch: b, product: b.product, mfgDate: b.mfgDate, expiryDate: b.expiryDate, status: 'RELEASED', availableQty: b.actualYield ?? b.batchSize, reservedQty: 0, warehouseId: body.finishedGoodsWarehouseId ?? 'wh-2', binId: null, warehouse: wh(body.finishedGoodsWarehouseId ?? 'wh-2'), bin: null });
        addNotification({ type: 'BATCH_RELEASE', severity: 'SUCCESS', title: `Batch ${b.batchNumber} released`, message: `QC released ${b.actualYield ?? b.batchSize} ${b.batchUnit} of ${b.product?.name}.`, link: `/batches/${b.id}` });
      }
      b.history.push({ id: nid('bh'), toStatus: b.status, createdAt: nowIso(), remarks: body.remarks ?? (action === 'complete' ? `Actual yield ${b.actualYield}` : undefined) });
      b.signatures.push({ id: nid('sig'), meaning: `BATCH_${action.toUpperCase()}D`, user: { name: user.name, role: user.role }, createdAt: nowIso(), hash: Math.random().toString(16).slice(2, 18) });
      addAudit('UPDATE', 'Batch', b.id, { status: before }, { status: b.status }, user);
      return json(b);
    }
  }

  // ---- formulas
  if (p === 'formulas' && method === 'POST') {
    const product = demo.products.find((x) => x.id === body.productId) ?? demo.products[0];
    const version = Math.max(0, ...demo.formulas.filter((f) => f.productId === product.id).map((f) => f.version)) + 1;
    const f: any = {
      id: nid('fmt'), productId: product.id, product, version, status: 'DRAFT',
      baseBatchSize: Number(body.baseBatchSize) || 100000, baseBatchUnit: body.baseBatchUnit ?? product.uom,
      expectedYieldPct: Number(body.expectedYieldPct) || 98, expectedWastagePct: Number(body.expectedWastagePct) || 2,
      effectiveFrom: nowIso(), approvedAt: null, changeReason: body.changeReason ?? null, instructions: body.instructions ?? null,
      createdById: user.id, approvedById: null, standardCost: null, _count: { items: (body.items ?? []).length },
      items: (body.items ?? []).map((i: any) => ({ id: nid('fi'), rawMaterialId: i.rawMaterialId, quantity: Number(i.quantity) || 0, unit: i.unit ?? 'KG', wastagePct: Number(i.wastagePct) || 0, stage: i.stage ?? null })),
      users: [{ id: user.id, name: user.name, role: user.role }],
      history: [{ id: nid('fh'), action: 'CREATED', userId: user.id, createdAt: nowIso(), remarks: body.changeReason ?? null }],
    };
    demo.formulas.unshift(f);
    addAudit('CREATE', 'Formula', f.id, null, { version: f.version, product: product.name }, user);
    return json(f);
  }
  if (seg[0] === 'formulas' && seg[2]) {
    const f = demo.formulas.find((x) => x.id === seg[1]) as any;
    if (!f) return notFound();
    const action = seg[2];
    if (action === 'submit') { f.status = 'PENDING_APPROVAL'; f.history.push({ id: nid('fh'), action: 'SUBMITTED', userId: user.id, createdAt: nowIso() }); return json(f); }
    if (action === 'approve') {
      for (const other of demo.formulas) if (other.productId === f.productId && other.status === 'APPROVED' && other.id !== f.id) { other.status = 'OBSOLETE'; other.history.push({ id: nid('fh'), action: 'OBSOLETED', userId: user.id, createdAt: nowIso(), remarks: `Retired when v${f.version} was approved` }); }
      f.status = 'APPROVED'; f.approvedAt = nowIso(); f.approvedById = user.id;
      if (!f.users.some((u: any) => u.id === user.id)) f.users.push({ id: user.id, name: user.name, role: user.role });
      f.history.push({ id: nid('fh'), action: 'APPROVED', userId: user.id, createdAt: nowIso(), remarks: body.remarks ?? null });
      addAudit('UPDATE', 'Formula', f.id, { status: 'PENDING_APPROVAL' }, { status: 'APPROVED' }, user);
      return json(f);
    }
    if (action === 'reject') { f.status = 'REJECTED'; f.history.push({ id: nid('fh'), action: 'REJECTED', userId: user.id, createdAt: nowIso(), remarks: body.remarks ?? null }); return json(f); }
    if (action === 'new-version') {
      const version = Math.max(0, ...demo.formulas.filter((x) => x.productId === f.productId).map((x) => x.version)) + 1;
      const clone: any = { ...f, id: nid('fmt'), version, status: 'DRAFT', approvedAt: null, approvedById: null, changeReason: body.changeReason ?? null, createdById: user.id, items: f.items.map((i: any) => ({ ...i, id: nid('fi') })), history: [{ id: nid('fh'), action: 'CREATED', userId: user.id, createdAt: nowIso(), remarks: body.changeReason ?? `New version from v${f.version}` }] };
      clone.users = [{ id: user.id, name: user.name, role: user.role }];
      clone._count = { items: clone.items.length };
      demo.formulas.unshift(clone);
      return json(clone);
    }
  }
  if (seg[0] === 'formulas' && seg.length === 2 && method === 'PATCH') {
    const f = demo.formulas.find((x) => x.id === seg[1]) as any;
    if (!f) return notFound();
    Object.assign(f, pick(body, ['baseBatchSize', 'baseBatchUnit', 'expectedYieldPct', 'instructions', 'changeReason', 'productId']));
    if (Array.isArray(body.items)) { f.items = body.items.map((i: any) => ({ id: nid('fi'), rawMaterialId: i.rawMaterialId, quantity: Number(i.quantity) || 0, unit: i.unit ?? 'KG', wastagePct: Number(i.wastagePct) || 0, stage: i.stage ?? null })); f._count = { items: f.items.length }; }
    f.history.push({ id: nid('fh'), action: 'UPDATED', userId: user.id, createdAt: nowIso() });
    return json(f);
  }

  // ---- qc
  if (seg[0] === 'qc' && seg[1] === 'samples' && seg[3] === 'results' && method === 'PUT') {
    const s = demo.qcSamples.find((x) => x.id === seg[2]) as any;
    if (!s) return notFound();
    s.results = (body.results ?? []).map((r: any) => ({ id: nid('qr'), passed: r.passed ?? true, ...r }));
    s._count = { results: s.results.length };
    if (s.status === 'PENDING') s.status = 'IN_TESTING';
    return json(s);
  }
  if (seg[0] === 'qc' && seg[1] === 'samples' && seg[3] === 'finalise') {
    const s = demo.qcSamples.find((x) => x.id === seg[2]) as any;
    if (!s) return notFound();
    const passed = (s.results ?? []).every((r: any) => r.passed !== false);
    s.status = passed ? 'PASSED' : 'FAILED';
    if (passed) s.coa = { documentId: nid('doc'), coaNumber: `COA-${new Date().getFullYear()}-${String(seq).slice(-3)}` };
    if (s.materialLotId) { const lot = demo.materialLots.find((l) => l.id === s.materialLotId); if (lot && passed) lot.status = 'APPROVED'; }
    if (s.batchId) { const b = demo.batches.find((b) => b.id === s.batchId); if (b) b.qcStatus = passed ? 'PASSED' : 'FAILED'; }
    addNotification({ type: 'QC_RESULT', severity: passed ? 'SUCCESS' : 'CRITICAL', title: `Sample ${s.sampleNumber} ${passed ? 'passed' : 'failed'}`, message: `Review the ${s.type === 'RAW_MATERIAL' ? 'material lot' : 'batch'} and act accordingly.`, link: '/qc' });
    return json(s);
  }

  // ---- purchasing
  if (p === 'purchase/orders' && method === 'POST') {
    const items = (body.items ?? []).map((i: any) => ({ id: nid('pi'), rawMaterialId: i.rawMaterialId, quantity: Number(i.quantity) || 0, receivedQty: 0, unitPrice: Number(i.unitPrice) || 0, taxPct: Number(i.taxPct) ?? 12 }));
    const po: any = { id: nid('po'), poNumber: `PO-${new Date().getFullYear()}-${String(seq).slice(-3)}`, supplierId: body.supplierId, supplier: demo.suppliers.find((s) => s.id === body.supplierId), orderDate: nowIso(), status: 'DRAFT', items, _count: { items: items.length }, total: +items.reduce((s: number, i: any) => s + i.quantity * i.unitPrice * (1 + i.taxPct / 100), 0).toFixed(2) };
    demo.purchaseOrders.unshift(po);
    addAudit('CREATE', 'PurchaseOrder', po.id, null, { poNumber: po.poNumber, total: po.total }, user);
    return json(po);
  }
  if (seg[0] === 'purchase' && seg[1] === 'orders' && seg[3] === 'approve') {
    const po = demo.purchaseOrders.find((x) => x.id === seg[2]) as any;
    if (!po) return notFound();
    po.status = 'APPROVED';
    addAudit('UPDATE', 'PurchaseOrder', po.id, { status: 'DRAFT' }, { status: 'APPROVED' }, user);
    return json(po);
  }
  if (p === 'purchase/grn' && method === 'POST') {
    const po = demo.purchaseOrders.find((x) => x.id === body.poId) as any;
    const grn: any = { id: nid('grn'), grnNumber: `GRN-${new Date().getFullYear()}-${String(seq).slice(-3)}`, supplierId: po?.supplierId, poId: po?.id ?? null, receivedAt: nowIso(), status: 'COMPLETED', _count: { items: (body.items ?? []).length }, items: [] };
    for (const it of body.items ?? []) {
      const rmId = it.rawMaterialId;
      const lot = { id: nid('lot'), lotNumber: it.lotNumber, rawMaterialId: rmId, supplierLot: it.lotNumber, status: 'QUARANTINE', availableQty: Number(it.quantity) || 0, unitCost: Number(it.unitCost) || rm(rmId)?.purchasePrice || 0, expiryDate: it.expiryDate ?? new Date(Date.now() + 365 * 864e5).toISOString(), receivedAt: nowIso(), warehouseId: body.warehouseId, binId: null };
      demo.materialLots.unshift(lot);
      demo.qcSamples.unshift({ id: nid('qc'), sampleNumber: `QCR-${new Date().getFullYear()}-${String(seq).slice(-3)}`, type: 'RAW_MATERIAL', status: 'PENDING', collectedAt: nowIso(), analystId: 'u-qc', batchId: null, batch: null, materialLotId: lot.id, materialLot: { rawMaterial: { name: rm(rmId)?.name ?? '' }, lotNumber: lot.lotNumber }, coa: null, _count: { results: 0 }, results: [] });
      grn.items.push({ id: nid('gi'), rawMaterial: { code: rm(rmId)?.code ?? '', name: rm(rmId)?.name ?? '' }, lotNumber: lot.lotNumber, quantity: Number(it.quantity) || 0, rejectedQty: Number(it.rejectedQty) || 0 });
      addLedger({ type: 'RECEIPT', materialLot: { rawMaterial: { name: rm(rmId)?.name ?? '' }, lotNumber: lot.lotNumber }, quantity: lot.availableQty, balanceAfter: lot.availableQty, reference: grn.grnNumber, reason: 'Supplier delivery' });
      if (po) { const line = po.items.find((x: any) => x.id === it.poItemId); if (line) line.receivedQty += Number(it.quantity) || 0; }
    }
    if (po) po.status = (po.items ?? []).every((i: any) => i.receivedQty >= i.quantity) ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
    demo.grns.unshift(grn);
    addNotification({ type: 'QC_PENDING', severity: 'INFO', title: `${grn.items.length} lot(s) awaiting QC`, message: `Goods receipt ${grn.grnNumber} posted — lots are in quarantine until QC approves them.`, link: '/qc' });
    return json(grn);
  }
  if (p === 'purchase/requisitions' && method === 'POST') {
    const pr: any = { id: nid('pr'), prNumber: `PR-${new Date().getFullYear()}-${String(seq).slice(-3)}`, status: 'SUBMITTED', notes: body.notes ?? null, createdAt: nowIso(), items: (body.items ?? []).map((i: any) => ({ id: nid('pri'), rawMaterial: { name: rm(i.rawMaterialId)?.name ?? '', uom: rm(i.rawMaterialId)?.uom ?? 'KG' }, quantity: Number(i.quantity) || 0 })) };
    demo.requisitions.unshift(pr);
    return json(pr);
  }
  if (p === 'purchase/requisitions/auto' && method === 'POST') {
    const low = demo.rawMaterials.filter((m) => m.stockState !== 'OK');
    const pr: any = { id: nid('pr'), prNumber: `PR-${new Date().getFullYear()}-${String(seq).slice(-3)}`, status: 'SUBMITTED', notes: 'Auto-raised from reorder levels', createdAt: nowIso(), items: low.map((m) => ({ id: nid('pri'), rawMaterial: { name: m.name, uom: m.uom }, quantity: Math.max(10, m.reorderLevel - m.usableStock) })) };
    demo.requisitions.unshift(pr);
    return json({ message: `${pr.items.length} material(s) below reorder level — requisition ${pr.prNumber} raised`, requisition: pr });
  }
  if (seg[0] === 'purchase' && seg[1] === 'requisitions' && seg[3] === 'decision') {
    const pr = demo.requisitions.find((x) => x.id === seg[2]) as any;
    if (!pr) return notFound();
    pr.status = body.approve ? 'APPROVED' : 'REJECTED';
    return json(pr);
  }
  if (seg[0] === 'purchase' && seg[1] === 'invoices' && (seg[3] === 'approve' || seg[3] === 'reject')) {
    const i = demo.invoices.find((x) => x.id === seg[2]) as any;
    if (!i) return notFound();
    i.status = seg[3] === 'approve' ? 'APPROVED' : 'REJECTED';
    addAudit('UPDATE', 'SupplierInvoice', i.id, null, { status: i.status }, user);
    return json(i);
  }

  // ---- inventory
  if (p === 'inventory/receive' && method === 'POST') {
    const m = rm(body.rawMaterialId);
    const lot: any = { id: nid('lot'), lotNumber: body.lotNumber ?? `LOT-${String(seq).slice(-3)}`, rawMaterialId: body.rawMaterialId, supplierLot: body.supplierLot ?? null, status: 'QUARANTINE', availableQty: Number(body.quantity) || 0, unitCost: Number(body.unitCost) || m?.purchasePrice || 0, expiryDate: body.expiryDate ?? new Date(Date.now() + (m?.shelfLifeMonths ?? 24) * 30 * 864e5).toISOString(), receivedAt: nowIso(), warehouseId: body.warehouseId, binId: null };
    demo.materialLots.unshift(lot);
    demo.qcSamples.unshift({ id: nid('qc'), sampleNumber: `QCR-${new Date().getFullYear()}-${String(seq).slice(-3)}`, type: 'RAW_MATERIAL', status: 'PENDING', collectedAt: nowIso(), analystId: 'u-qc', batchId: null, batch: null, materialLotId: lot.id, materialLot: { rawMaterial: { name: m?.name ?? '' }, lotNumber: lot.lotNumber }, coa: null, _count: { results: 0 }, results: [] });
    addLedger({ type: 'RECEIPT', materialLot: { rawMaterial: { name: m?.name ?? '' }, lotNumber: lot.lotNumber }, quantity: lot.availableQty, balanceAfter: lot.availableQty, reference: body.reason ?? 'Manual receipt', reason: body.reason ?? 'Manual receipt' });
    return json(lotView(lot));
  }
  if (p === 'inventory/issue' && method === 'POST') {
    const used = consumeFefo(body.rawMaterialId, Number(body.quantity) || 0, body.reason ?? 'Manual issue');
    const type = body.type === 'WRITE_OFF' ? 'WRITE_OFF' : body.type === 'RETURN' ? 'RETURN' : 'ISSUE';
    if (type !== 'ISSUE' && used[0]) addLedger({ type, materialLot: { rawMaterial: { name: rm(body.rawMaterialId)?.name ?? '' }, lotNumber: used[0].lot.lotNumber }, quantity: -used.reduce((s, u) => s + u.take, 0), balanceAfter: used[0].lot.availableQty, reference: body.reason ?? type, reason: body.reason ?? '' });
    return json({ ok: true, used: used.map((u) => ({ lotNumber: u.lot.lotNumber, quantity: u.take })) });
  }
  if (p === 'inventory/transfer' && method === 'POST') {
    const lot = demo.materialLots.find((l) => l.id === body.materialLotId) as any;
    if (!lot) return notFound();
    const dest = wh(body.toWarehouseId);
    lot.warehouseId = body.toWarehouseId;
    lot.binId = body.toBinId ?? null;
    addLedger({ type: 'TRANSFER_OUT', materialLot: { rawMaterial: { name: rm(lot.rawMaterialId)?.name ?? '' }, lotNumber: lot.lotNumber }, quantity: 0, balanceAfter: lot.availableQty, reference: `→ ${dest?.name ?? 'warehouse'}`, reason: 'Location transfer' });
    return json(lotView(lot));
  }
  if (p === 'inventory/adjust' && method === 'POST') {
    const lot = demo.materialLots.find((l) => l.id === body.materialLotId) as any;
    if (!lot) return notFound();
    const before = lot.availableQty;
    const next = Number(body.newQuantity);
    lot.availableQty = Number.isFinite(next) ? next : before;
    addLedger({ type: 'ADJUSTMENT', materialLot: { rawMaterial: { name: rm(lot.rawMaterialId)?.name ?? '' }, lotNumber: lot.lotNumber }, quantity: +(lot.availableQty - before).toFixed(3), balanceAfter: lot.availableQty, reference: 'Adjustment', reason: body.reason ?? 'Physical count adjustment' });
    addAudit('UPDATE', 'MaterialLot', lot.id, { availableQty: before }, { availableQty: lot.availableQty }, user);
    return json(lotView(lot));
  }
  if (p === 'inventory/transfer-orders' && method === 'POST') {
    const to: any = { id: nid('to'), trfNumber: `TRF-${new Date().getFullYear()}-${String(seq).slice(-3)}`, from: wh(body.fromWarehouseId), to: wh(body.toWarehouseId), status: 'DRAFT', createdAt: nowIso(), items: (body.items ?? []).map((i: any) => ({ id: nid('toi'), rawMaterialLot: { lotNumber: demo.materialLots.find((l) => l.id === i.materialLotId)?.lotNumber ?? '' }, quantity: Number(i.quantity) || 0 })) };
    demo.transferOrders.unshift(to);
    return json(to);
  }
  if (seg[0] === 'inventory' && seg[1] === 'transfer-orders' && seg[3] === 'execute') {
    const to = demo.transferOrders.find((x) => x.id === seg[2]) as any;
    if (!to) return notFound();
    to.status = 'COMPLETED';
    return json(to);
  }
  if (p === 'inventory/counts' && method === 'POST') {
    const items = demo.materialLots.filter((l) => l.warehouseId === body.warehouseId).map((l) => ({ id: nid('ci'), rawMaterial: { name: rm(l.rawMaterialId)?.name ?? '', uom: rm(l.rawMaterialId)?.uom ?? 'KG' }, systemQty: l.availableQty, countedQty: null }));
    const c: any = { id: nid('cnt'), countNumber: `CNT-${new Date().getFullYear()}-${String(seq).slice(-3)}`, warehouse: wh(body.warehouseId), status: 'OPEN', createdAt: nowIso(), _count: { items: items.length }, items };
    demo.counts.unshift(c);
    return json(c);
  }
  if (seg[0] === 'inventory' && seg[1] === 'counts' && seg[3] === 'items' && method === 'PATCH') {
    const c = demo.counts.find((x) => x.id === seg[2]) as any;
    if (!c) return notFound();
    for (const it of body.items ?? []) { const line = c.items.find((x: any) => x.id === it.id); if (line) line.countedQty = Number(it.countedQty); }
    return json(c);
  }
  if (seg[0] === 'inventory' && seg[1] === 'counts' && seg[3] === 'reconcile') {
    const c = demo.counts.find((x) => x.id === seg[2]) as any;
    if (!c) return notFound();
    c.status = 'RECONCILED';
    for (const line of c.items) if (line.countedQty !== null && line.countedQty !== undefined && Number(line.countedQty) !== Number(line.systemQty)) {
      addLedger({ type: 'ADJUSTMENT', materialLot: { rawMaterial: { name: line.rawMaterial.name }, lotNumber: '—' }, quantity: +(Number(line.countedQty) - Number(line.systemQty)).toFixed(3), balanceAfter: Number(line.countedQty), reference: c.countNumber, reason: 'Cycle count variance' });
    }
    return json(c);
  }

  // ---- production
  if (p === 'production/work-orders' && method === 'POST') {
    const wo: any = { id: nid('wo'), woNumber: `WO-${new Date().getFullYear()}-${String(seq).slice(-3)}`, product: demo.products.find((x) => x.id === body.productId) ?? demo.products[0], quantity: Number(body.quantity) || 100000, plannedStart: body.plannedStart ?? nowIso(), plannedEnd: body.plannedEnd ?? nowIso(), shift: demo.shifts.find((s) => s.id === body.shiftId) ?? null, lineName: body.lineName ?? null, operators: (body.operatorIds ?? []).map((id: string) => ({ user: { name: demo.DEMO_USERS.find((u) => u.id === id)?.name ?? 'Operator' } })), progressPct: 0, status: 'PLANNED', batch: null };
    demo.workOrders.unshift(wo);
    return json(wo);
  }
  if (seg[0] === 'production' && seg[1] === 'work-orders' && seg[3] === 'create-batch') {
    const wo = demo.workOrders.find((x) => x.id === seg[2]) as any;
    if (!wo) return notFound();
    const formula = demo.formulas.find((f) => f.productId === wo.product?.id && f.status === 'APPROVED') ?? null;
    const b: any = { id: nid('bat'), batchNumber: `B-${new Date().getFullYear()}-${String(demo.batches.length + 1).padStart(3, '0')}`, productId: wo.product?.id, product: wo.product, formulaId: formula?.id ?? null, formula, status: 'DRAFT', qcStatus: 'PENDING', source: 'SYSTEM', batchSize: wo.quantity, batchUnit: wo.product?.uom ?? 'TAB', mfgDate: nowIso(), expiryDate: new Date(Date.now() + 730 * 864e5).toISOString(), actualYield: null, yieldPct: null, wastagePct: null, theoreticalYield: Math.round(wo.quantity * 0.98), materialCost: null, costPerUnit: null, createdById: user.id, releasedAt: null, materials: [], qcSamples: [], signatures: [], history: [{ id: nid('bh'), toStatus: 'DRAFT', createdAt: nowIso(), remarks: `From work order ${wo.woNumber}` }] };
    demo.batches.unshift(b);
    wo.batch = b;
    wo.status = 'SCHEDULED';
    return json(b);
  }
  if (p === 'production/plans' && method === 'POST') {
    const pp: any = { id: nid('pp'), planNumber: `PP-${new Date().getFullYear()}-${String(seq).slice(-3)}`, periodStart: body.periodStart ?? nowIso(), periodEnd: body.periodEnd ?? nowIso(), status: 'DRAFT', items: (body.items ?? []).map((i: any) => ({ id: nid('ppi'), product: demo.products.find((p) => p.id === i.productId), plannedQty: Number(i.plannedQty) || 0, plannedBatches: Number(i.plannedBatches) || 1 })) };
    demo.productionPlans.unshift(pp);
    return json(pp);
  }

  // ---- finished goods
  if (p === 'finished-goods/dispatch' && method === 'POST') {
    const dsp: any = { id: nid('dsp'), dispatchNumber: `DSP-${new Date().getFullYear()}-${String(seq).slice(-3)}`, dispatchedAt: nowIso(), customer: body.customer, destination: body.destination ?? null, invoiceRef: body.invoiceRef ?? null, vehicleNo: body.vehicleNo ?? null, items: [] };
    for (const it of body.items ?? []) {
      const fg = demo.fgLots.find((f) => f.id === it.fgLotId) as any;
      if (fg) { fg.availableQty = Math.max(0, fg.availableQty - (Number(it.quantity) || 0)); fg.status = fg.availableQty > 0 ? fg.status : 'DEPLETED'; }
      dsp.items.push({ id: nid('di'), quantity: Number(it.quantity) || 0, fgLot: fgView(fg) });
      addLedger({ type: 'DISPATCH', fgLot: { product: { name: fg?.product?.name ?? '' }, batch: { batchNumber: fg?.batch?.batchNumber ?? '' } }, quantity: -(Number(it.quantity) || 0), balanceAfter: fg?.availableQty ?? 0, reference: dsp.dispatchNumber, reason: body.customer });
    }
    demo.dispatches.unshift(dsp);
    return json(dsp);
  }
  if (seg[0] === 'finished-goods' && seg[3] === 'reserve') {
    const fg = demo.fgLots.find((f) => f.id === seg[2]) as any;
    if (!fg) return notFound();
    fg.reservedQty = Math.max(0, +(fg.reservedQty + (Number(body.quantity) || 0)).toFixed(0));
    return json(fgView(fg));
  }

  // ---- expiry
  if (seg[0] === 'expiry' && seg[1] === 'write-off') {
    const lot = demo.materialLots.find((l) => l.id === seg[2]) as any;
    if (!lot) return notFound();
    addLedger({ type: 'WRITE_OFF', materialLot: { rawMaterial: { name: rm(lot.rawMaterialId)?.name ?? '' }, lotNumber: lot.lotNumber }, quantity: -lot.availableQty, balanceAfter: 0, reference: 'Write-off', reason: 'Expired stock' });
    lot.availableQty = 0;
    lot.status = 'DEPLETED';
    return json(lotView(lot));
  }
  if (p === 'expiry/sweep' && method === 'POST') {
    addNotification({ type: 'EXPIRY', severity: 'WARNING', title: 'Alert sweep completed', message: 'Near-expiry and low-stock notifications were refreshed.', link: '/notifications' });
    return json({ ok: true, notifications: 1 });
  }
  if (p === 'expiry/recalls' && method === 'POST') {
    const b = demo.batches.find((x) => x.id === body.batchId);
    const r: any = { id: nid('rc'), recallNumber: `RC-${new Date().getFullYear()}-${String(seq).slice(-3)}`, batch: b, classification: body.classification, reason: body.reason, quantityDispatched: 0, quantityRecovered: null, status: 'OPEN' };
    demo.recalls.unshift(r);
    if (b) { for (const fg of demo.fgLots) if (fg.batchId === b.id) fg.status = 'RECALLED'; }
    addNotification({ type: 'RECALL', severity: 'CRITICAL', title: `Recall opened for ${b?.batchNumber}`, message: body.reason, link: '/expiry' });
    return json(r);
  }
  if (seg[0] === 'expiry' && seg[1] === 'recalls' && seg[3] === 'close') {
    const r = demo.recalls.find((x) => x.id === seg[2]) as any;
    if (!r) return notFound();
    r.status = 'CLOSED';
    r.quantityRecovered = Number(body.quantityRecovered) || 0;
    return json(r);
  }

  // ---- notifications
  if (p === 'notifications/read-all' && method === 'POST') { for (const n of demo.notifications) n.readAt = n.readAt ?? nowIso(); return json({ ok: true }); }
  if (seg[0] === 'notifications' && seg[2] === 'read') { const n = demo.notifications.find((x) => x.id === seg[1]) as any; if (n) n.readAt ??= nowIso(); return json({ ok: true }); }

  // ---- documents
  if (p === 'documents' && method === 'POST') {
    const fd = await req.formData().catch(() => null);
    const created: any[] = [];
    if (fd) {
      const files = fd.getAll('files').filter((f) => typeof f !== 'string') as File[];
      for (const f of files) created.push({ id: nid('doc'), title: f.name, type: String(fd.get('type') ?? 'OTHER'), version: 1, size: f.size, fileName: f.name, mimeType: f.type || 'application/octet-stream', allowedRoles: String(fd.get('allowedRoles') ?? '').split(',').filter(Boolean), createdAt: nowIso() });
    }
    demo.documents.unshift(...created);
    return json(created);
  }
  if (seg[0] === 'documents' && seg[2] === 'versions') {
    const d = demo.documents.find((x) => x.id === seg[1]) as any;
    if (!d) return notFound();
    d.version += 1;
    return json(d);
  }
  if (seg[0] === 'documents' && seg[2] === 'share') return json({ url: `${req.nextUrl.origin}/api/documents/${seg[1]}/download?demo-share=1`, expiresInHours: Number(body.hours) || 72 });

  // ---- ai
  if ((p === 'ai/bmr/upload' || p === 'ai/invoice/upload') && method === 'POST') {
    const fd = await req.formData().catch(() => null);
    const kind = p.includes('bmr') ? 'BMR' : 'INVOICE';
    const file = (fd?.getAll('files') ?? []).find((f) => typeof f !== 'string') as File | undefined;
    const job: any = {
      id: nid('job'), kind, status: 'REVIEW', confidence: 0.9, createdAt: nowIso(), updatedAt: nowIso(),
      document: { fileName: file?.name ?? (kind === 'BMR' ? 'uploaded-bmr.pdf' : 'uploaded-invoice.pdf'), mimeType: file?.type || 'application/pdf' },
      error: null, createdBatchId: null, createdInvoiceId: null,
      extracted: kind === 'BMR'
        ? { fieldConfidence: { batchNumber: 0.93, productId: 0.88, manufacturingDate: 0.9, expiryDate: 0.86, 'batchSize.value': 0.7 }, illegibleFields: [], batchNumber: 'B-NEW-001', productName: 'As written on the form', formulaVersion: 'v2', manufacturingDate: nowIso().slice(0, 10), expiryDate: new Date(Date.now() + 730 * 864e5).toISOString().slice(0, 10), batchSize: { value: 100000, unit: 'TAB' }, operatorId: null, operatorName: 'R. Sharma', qcStatus: 'PENDING', yield: { theoretical: 98000, actual: 97400, percent: 99.39 }, ingredients: [], materialConsumption: [] }
        : { fieldConfidence: { invoiceNumber: 0.95, invoiceDate: 0.92, total: 0.88 }, illegibleFields: [], invoiceNumber: 'INV-NEW-001', invoiceDate: nowIso().slice(0, 10), supplierId: null, supplierName: 'As written on the bill', supplierGstin: '', poId: null, subtotal: 10000, tax: { total: 1800 }, total: 11800, items: [] },
      validation: { engine: 'keyword-rules', report: null, match: null },
    };
    job.corrected = job.extracted;
    demo.aiJobs.unshift(job);
    return json(job);
  }
  if (seg[0] === 'ai' && seg[1] === 'jobs' && seg[3]) {
    const j = demo.aiJobs.find((x) => x.id === seg[2]) as any;
    if (!j) return notFound();
    const action = seg[3];
    if (action === 'corrections') { j.corrected = body.corrected ?? j.corrected; j.validation = { engine: 'keyword-rules', report: j.kind === 'BMR' ? { score: 91, verdict: 'PASS', findings: [] } : null, match: j.kind === 'INVOICE' ? { status: 'MATCHED', flags: [], priceMismatch: [], quantityMismatch: [] } : null } ; j.updatedAt = nowIso(); return json(j); }
    if (action === 'reprocess') { j.status = 'REVIEW'; j.updatedAt = nowIso(); return json(j); }
    if (action === 'reject') { j.status = 'REJECTED'; return json(j); }
    if (action === 'commit') {
      if (j.kind === 'BMR') { const b: any = { id: nid('bat'), batchNumber: j.corrected?.batchNumber ?? 'B-NEW', productId: 'prd-1', product: demo.products[0], formulaId: null, formula: null, status: 'DRAFT', qcStatus: 'PENDING', source: 'AI_IMPORT', batchSize: Number(j.corrected?.batchSize?.value) || 100000, batchUnit: j.corrected?.batchSize?.unit ?? 'TAB', mfgDate: j.corrected?.manufacturingDate ?? nowIso(), expiryDate: j.corrected?.expiryDate ?? nowIso(), actualYield: Number(j.corrected?.yield?.actual) || null, yieldPct: Number(j.corrected?.yield?.percent) || null, wastagePct: null, theoreticalYield: Number(j.corrected?.yield?.theoretical) || null, materialCost: null, costPerUnit: null, createdById: user.id, releasedAt: null, materials: [], qcSamples: [], signatures: [], history: [{ id: nid('bh'), toStatus: 'DRAFT', createdAt: nowIso(), remarks: 'Imported from scanned BMR (Document AI)' }] }; demo.batches.unshift(b); j.createdBatchId = b.id; }
      else { const inv: any = { id: nid('inv'), invoiceNumber: j.corrected?.invoiceNumber ?? 'INV-NEW', supplierId: j.corrected?.supplierId ?? 'sup-2', supplier: demo.suppliers.find((s) => s.id === (j.corrected?.supplierId ?? 'sup-2')), poId: null, po: null, grnId: null, grn: null, invoiceDate: j.corrected?.invoiceDate ?? nowIso(), total: Number(j.corrected?.total) || 0, status: 'MATCHED', source: 'AI_IMPORT', matchResult: { status: 'MATCHED', flags: [], priceMismatch: [], quantityMismatch: [] }, items: (j.corrected?.items ?? []).map((i: any) => ({ id: nid('ii'), description: i.description, rawMaterialId: i.rawMaterialId ?? null, rawMaterial: i.rawMaterialId ? { code: rm(i.rawMaterialId)?.code ?? '' } : null, quantity: i.quantity, unitPrice: i.unitPrice, amount: i.amount, taxPct: i.taxPct })) }; demo.invoices.unshift(inv); j.createdInvoiceId = inv.id; }
      j.status = 'APPROVED';
      return json(j);
    }
  }
  if (p === 'ai/search' && method === 'POST') {
    const q = String(body.question ?? '').toLowerCase();
    const tables: any[] = [];
    const tools: string[] = [];
    if (/expir|expired/.test(q)) { tools.push('searchExpiring'); tables.push({ title: 'Expired and near-expiry stock', columns: ['Item', 'Lot', 'Expiry', 'Qty'], rows: [...demo.expirySummary.rawMaterialExpired, ...demo.expirySummary.rawMaterialNearExpiry].map((l: any) => [l.rawMaterial.name, l.lotNumber, l.expiryDate.slice(0, 10), l.availableQty]) }); }
    if (/batch/.test(q)) { tools.push('searchBatches'); tables.push({ title: 'Batches', columns: ['Batch', 'Product', 'Status', 'Yield %'], rows: demo.batches.map((b) => [b.batchNumber, b.product?.name ?? '', b.status, b.yieldPct ?? '—']) }); }
    if (/reorder|below|low/.test(q)) { tools.push('searchStockStatus'); tables.push({ title: 'Below reorder level', columns: ['Code', 'Material', 'Usable', 'Reorder'], rows: demo.rawMaterials.filter((m) => m.stockState !== 'OK').map((m) => [m.code, m.name, m.usableStock, m.reorderLevel]) }); }
    if (/invoice|supplier/.test(q)) { tools.push('searchInvoices'); tables.push({ title: 'Supplier invoices', columns: ['Invoice', 'Supplier', 'Total', 'Status'], rows: demo.invoices.map((i) => [i.invoiceNumber, demo.suppliers.find((s) => s.id === i.supplierId)?.name ?? '', i.total, i.status]) }); }
    if (!tables.length) { tools.push('searchBatches'); tables.push({ title: 'Batches', columns: ['Batch', 'Product', 'Status'], rows: demo.batches.slice(0, 5).map((b) => [b.batchNumber, b.product?.name ?? '', b.status]) }); }
    return json({ answer: `Demo mode: matched ${tables.reduce((s, t) => s + t.rows.length, 0)} record(s) using fixed read-only searches (no SQL was generated).`, engine: 'keyword-rules', toolsUsed: tools, tables });
  }

  // ---- master data creates
  if (p === 'raw-materials' && method === 'POST') {
    const m: any = { id: nid('rm'), usableStock: 0, quarantineStock: 0, stockState: 'OUT_OF_STOCK', ...body };
    demo.rawMaterials.push(m);
    return json(materialView(m));
  }
  if (seg[0] === 'raw-materials' && seg.length === 2 && method === 'PATCH') { const m = demo.rawMaterials.find((x) => x.id === seg[1]) as any; if (!m) return notFound(); Object.assign(m, body); return json(materialView(m)); }
  if (p === 'products' && method === 'POST') { const x: any = { id: nid('prd'), ...body }; demo.products.push(x); return json(x); }
  if (p === 'suppliers' && method === 'POST') { const x: any = { id: nid('sup'), isApproved: !!body.isApproved, ...body }; demo.suppliers.push(x); return json(x); }
  if (seg[0] === 'suppliers' && seg.length === 2 && method === 'PATCH') { const x = demo.suppliers.find((s) => s.id === seg[1]) as any; if (!x) return notFound(); Object.assign(x, body); return json(x); }
  if (p === 'warehouses' && method === 'POST') { const x: any = { id: nid('wh'), _count: { racks: 0, bins: 0 }, ...body }; demo.warehouses.push(x); return json(x); }
  if (p === 'racks' && method === 'POST') { const x: any = { id: nid('rk'), ...body }; demo.racks.push(x); return json(x); }
  if (p === 'bins' && method === 'POST') { const x: any = { id: nid('bin'), ...body }; demo.bins.push(x); return json(x); }
  if (p === 'users' && method === 'POST') { const x: any = { id: nid('u'), email: body.email, name: body.name, role: body.role, password: body.password, permissions: [], isActive: true, lastLoginAt: null }; demo.DEMO_USERS.push(x); return json({ ...pick(x, ['id', 'name', 'email', 'role']), isActive: true, lastLoginAt: null }); }
  if (seg[0] === 'users' && seg.length === 2 && method === 'PATCH') { const x = demo.DEMO_USERS.find((u) => u.id === seg[1]) as any; if (!x) return notFound(); Object.assign(x, pick(body, ['name', 'role', 'email'])); if (typeof body.isActive === 'boolean') x.isActive = body.isActive; return json({ ...pick(x, ['id', 'name', 'email', 'role']), isActive: x.isActive ?? true, lastLoginAt: null }); }

  return notFound(`No demo handler for ${method} /api/${p}`);
}

function findMaterialIdByCode(code?: string | null) { return demo.rawMaterials.find((m) => m.code === code)?.id ?? null; }

function validateBatch(b?: any) {
  if (!b) return { score: 0, verdict: 'FAIL', findings: [{ severity: 'CRITICAL', code: 'BATCH_MISSING', message: 'Batch not found.' }], narrative: null };
  const findings: any[] = [];
  if (!b.expiryDate) findings.push({ severity: 'CRITICAL', code: 'EXPIRY_MISSING', message: 'Expiry date is missing.' });
  if (b.yieldPct && b.yieldPct < 95) findings.push({ severity: 'WARNING', code: 'LOW_YIELD', message: `Yield ${b.yieldPct}% is below the 95% control limit.` });
  if ((b.materials ?? []).some((m: any) => !m.issuedQty && ['IN_PRODUCTION', 'QC_REVIEW', 'RELEASED'].includes(b.status))) findings.push({ severity: 'WARNING', code: 'MATERIALS_NOT_ISSUED', message: 'Some materials have no recorded issue quantity.' });
  if (!(b.signatures ?? []).length) findings.push({ severity: 'INFO', code: 'NO_SIGNATURES', message: 'No electronic signatures recorded yet.' });
  const score = Math.max(40, 100 - findings.reduce((s, f) => s + (f.severity === 'CRITICAL' ? 35 : f.severity === 'WARNING' ? 12 : 5), 0));
  return { score, verdict: findings.some((f) => f.severity === 'CRITICAL') ? 'FAIL' : findings.length ? 'PASS_WITH_FINDINGS' : 'PASS', findings, narrative: findings.length ? 'Automated checks found issues that need a reviewer’s attention.' : 'All automated checks passed.' };
}

// ------------------------------------------------------------------ entry
async function proxy(req: NextRequest, seg: string[]) {
  const url = `${BACKEND_URL}/api/${seg.join('/')}${req.nextUrl.search}`;
  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.delete('content-length');
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer();
  const res = await fetch(url, { method: req.method, headers, body });
  const out = new Headers(res.headers);
  out.delete('content-encoding');
  out.delete('content-length');
  return new NextResponse(res.body, { status: res.status, headers: out });
}

async function entry(req: NextRequest, ctx: { params: { path: string[] } }) {
  const seg = ctx.params.path ?? [];
  if (!DEMO_ENABLED) return proxy(req, seg);
  try { return await handle(req, req.method.toUpperCase(), seg); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}

export const GET = entry;
export const POST = entry;
export const PUT = entry;
export const PATCH = entry;
export const DELETE = entry;
