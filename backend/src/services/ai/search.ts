import { Role } from '@prisma/client';
import { can } from '../../config/permissions';
import { prisma } from '../../lib/prisma';
import { aiEnabled, anthropic } from './provider';
import { env } from '../../config/env';
import { stockByMaterial } from '../inventory.service';

/**
 * Natural-language search WITHOUT text-to-SQL. The model may only call a fixed set of parameterised tools,
 * each guarded by the caller's RBAC permission. It can never see or run raw SQL.
 */
interface ToolDef { name: string; permission: string; description: string; schema: any; run: (a: any) => Promise<Table> }
export interface Table { title: string; columns: string[]; rows: any[][] }

const dateStr = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
const insens = (v: string) => ({ contains: v, mode: 'insensitive' as const });

const TOOLS: ToolDef[] = [
  {
    name: 'search_batches', permission: 'batch:read',
    description: 'Find manufactured batches by product, month/year of manufacture, date range, status or QC status.',
    schema: { type: 'object', properties: { product: { type: 'string' }, month: { type: 'integer', minimum: 1, maximum: 12 }, year: { type: 'integer' }, from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, status: { type: 'string', enum: ['DRAFT', 'APPROVED', 'IN_PRODUCTION', 'QC_REVIEW', 'RELEASED', 'REJECTED', 'CANCELLED'] }, qcStatus: { type: 'string', enum: ['PENDING', 'IN_TESTING', 'PASSED', 'FAILED'] }, batchNumber: { type: 'string' } } },
    run: async (a) => {
      let gte: Date | undefined, lt: Date | undefined;
      if (a.month) { const y = a.year ?? new Date().getUTCFullYear(); gte = new Date(Date.UTC(y, a.month - 1, 1)); lt = new Date(Date.UTC(y, a.month, 1)); }
      else if (a.year) { gte = new Date(Date.UTC(a.year, 0, 1)); lt = new Date(Date.UTC(a.year + 1, 0, 1)); }
      if (a.from) gte = new Date(a.from);
      if (a.to) lt = new Date(new Date(a.to).getTime() + 86_400_000);
      const rows = await prisma.batch.findMany({
        where: { ...(a.product && { product: { OR: [{ name: insens(a.product) }, { code: insens(a.product) }] } }), ...(gte || lt ? { mfgDate: { gte, lt } } : {}), ...(a.status && { status: a.status }), ...(a.qcStatus && { qcStatus: a.qcStatus }), ...(a.batchNumber && { batchNumber: insens(a.batchNumber) }) },
        include: { product: true }, orderBy: { mfgDate: 'desc' }, take: 50,
      });
      return { title: 'Batches', columns: ['Batch', 'Product', 'Mfg date', 'Size', 'Status', 'QC', 'Yield %'], rows: rows.map((b) => [b.batchNumber, b.product.name, dateStr(b.mfgDate), `${b.batchSize} ${b.batchUnit}`, b.status, b.qcStatus, b.yieldPct?.toString() ?? '']) };
    },
  },
  {
    name: 'batches_by_material', permission: 'batch:read',
    description: 'List batches that consumed a given raw material (by name or code), optionally a specific lot number.',
    schema: { type: 'object', properties: { material: { type: 'string' }, lotNumber: { type: 'string' } }, required: ['material'] },
    run: async (a) => {
      const rows = await prisma.batchMaterial.findMany({
        where: { rawMaterial: { OR: [{ name: insens(a.material) }, { code: insens(a.material) }] }, issuedQty: { gt: 0 }, ...(a.lotNumber && { consumptions: { some: { materialLot: { lotNumber: insens(a.lotNumber) } } } }) },
        include: { batch: { include: { product: true } }, rawMaterial: true, consumptions: { include: { materialLot: true } } }, orderBy: { batch: { mfgDate: 'desc' } }, take: 50,
      });
      return { title: `Batches using "${a.material}"`, columns: ['Batch', 'Product', 'Mfg date', 'Material', 'Qty', 'Lots'], rows: rows.map((r) => [r.batch.batchNumber, r.batch.product.name, dateStr(r.batch.mfgDate), r.rawMaterial.name, `${r.issuedQty} ${r.unit}`, r.consumptions.map((c) => c.materialLot.lotNumber).join(', ')]) };
    },
  },
  {
    name: 'list_expired', permission: 'expiry:read',
    description: 'List expired (or expiring within N days) raw-material lots and/or finished-goods lots that still hold stock.',
    schema: { type: 'object', properties: { scope: { type: 'string', enum: ['raw_material', 'finished_goods', 'all'] }, withinDays: { type: 'integer', description: 'If set, list items expiring within this many days instead of already expired' } } },
    run: async (a) => {
      const now = new Date(), until = a.withinDays ? new Date(now.getTime() + a.withinDays * 86_400_000) : now;
      const where = a.withinDays ? { gt: now, lte: until } : { lte: now };
      const out: any[][] = [];
      if (a.scope !== 'finished_goods') (await prisma.materialLot.findMany({ where: { availableQty: { gt: 0 }, expiryDate: where }, include: { rawMaterial: true }, orderBy: { expiryDate: 'asc' }, take: 50 })).forEach((l) => out.push(['Raw material', l.rawMaterial.name, l.lotNumber, `${l.availableQty} ${l.rawMaterial.uom}`, dateStr(l.expiryDate)]));
      if (a.scope !== 'raw_material') (await prisma.finishedGoodLot.findMany({ where: { availableQty: { gt: 0 }, expiryDate: where }, include: { product: true, batch: true }, orderBy: { expiryDate: 'asc' }, take: 50 })).forEach((l) => out.push(['Finished good', l.product.name, l.batch.batchNumber, `${l.availableQty}`, dateStr(l.expiryDate)]));
      return { title: a.withinDays ? `Expiring within ${a.withinDays} days` : 'Expired stock', columns: ['Type', 'Item', 'Lot / Batch', 'Qty', 'Expiry'], rows: out };
    },
  },
  {
    name: 'search_invoices', permission: 'purchase:read',
    description: 'Find supplier invoices by supplier name, invoice number, date range, or status.',
    schema: { type: 'object', properties: { supplier: { type: 'string' }, invoiceNumber: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, status: { type: 'string', enum: ['PENDING_REVIEW', 'MATCHED', 'MISMATCH', 'APPROVED', 'REJECTED', 'PAID'] } } },
    run: async (a) => {
      const rows = await prisma.supplierInvoice.findMany({
        where: { ...(a.supplier && { supplier: { name: insens(a.supplier) } }), ...(a.invoiceNumber && { invoiceNumber: insens(a.invoiceNumber) }), ...(a.status && { status: a.status }), ...((a.from || a.to) && { invoiceDate: { gte: a.from ? new Date(a.from) : undefined, lte: a.to ? new Date(a.to) : undefined } }) },
        include: { supplier: true }, orderBy: { invoiceDate: 'desc' }, take: 50,
      });
      return { title: 'Invoices', columns: ['Invoice', 'Date', 'Supplier', 'Total (INR)', 'Status'], rows: rows.map((i) => [i.invoiceNumber, dateStr(i.invoiceDate), i.supplier.name, i.total.toString(), i.status]) };
    },
  },
  {
    name: 'stock_status', permission: 'stock:read',
    description: 'Current usable, quarantined and expired stock for raw materials (optionally filtered by name/code).',
    schema: { type: 'object', properties: { material: { type: 'string' }, belowReorderOnly: { type: 'boolean' } } },
    run: async (a) => {
      const [mats, stock] = await Promise.all([prisma.rawMaterial.findMany({ where: a.material ? { OR: [{ name: insens(a.material) }, { code: insens(a.material) }] } : undefined, take: 100 }), stockByMaterial()]);
      const rows = mats.map((m) => { const s = stock.get(m.id); return { m, usable: s?.usable ?? 0, s }; }).filter((r) => !a.belowReorderOnly || Number(r.usable) <= Number(r.m.reorderLevel));
      return { title: 'Stock status', columns: ['Code', 'Material', 'Usable', 'Quarantine', 'Reorder level', 'UOM'], rows: rows.map((r) => [r.m.code, r.m.name, r.usable.toString(), (r.s?.quarantine ?? 0).toString(), r.m.reorderLevel.toString(), r.m.uom]) };
    },
  },
];

export interface SearchResult { answer: string; tables: Table[]; engine: 'claude' | 'rules'; toolsUsed: string[] }

export async function aiSearch(question: string, role: Role): Promise<SearchResult> {
  const allowed = TOOLS.filter((t) => can(role, t.permission));
  if (!allowed.length) return { answer: 'Your role does not have access to searchable data.', tables: [], engine: 'rules', toolsUsed: [] };
  return aiEnabled() ? claudeSearch(question, allowed) : ruleSearch(question, allowed);
}

async function claudeSearch(question: string, tools: ToolDef[]): Promise<SearchResult> {
  const tables: Table[] = [], used: string[] = [];
  const messages: any[] = [{ role: 'user', content: question }];
  const system = `You answer questions about a pharmaceutical ERP by calling the provided search tools. Today is ${new Date().toISOString().slice(0, 10)}. ` +
    'If a month is named without a year, assume the current year. Never guess data: only report what the tools return. After tools return, reply with one or two plain sentences summarising the result count and key finding; the full tables are shown to the user separately. If no tool fits, say what you can search for.';
  for (let turn = 0; turn < 4; turn++) {
    const res = await anthropic().messages.create({ model: env.AI_MODEL, max_tokens: 700, system, tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })), messages });
    if (res.stop_reason !== 'tool_use') return { answer: res.content.filter((c) => c.type === 'text').map((c: any) => c.text).join('\n').trim(), tables, engine: 'claude', toolsUsed: used };
    messages.push({ role: 'assistant', content: res.content });
    const results: any[] = [];
    for (const c of res.content) {
      if (c.type !== 'tool_use') continue;
      const tool = tools.find((t) => t.name === c.name);
      try {
        const t = await tool!.run(c.input);
        tables.push(t); used.push(c.name);
        results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify({ title: t.title, count: t.rows.length, columns: t.columns, rows: t.rows.slice(0, 15) }) });
      } catch (e: any) { results.push({ type: 'tool_result', tool_use_id: c.id, is_error: true, content: e.message }); }
    }
    messages.push({ role: 'user', content: results });
  }
  return { answer: 'Here is what I found.', tables, engine: 'claude', toolsUsed: used };
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** Offline fallback: a handful of intent patterns mapped onto the same safe tools. */
async function ruleSearch(q: string, tools: ToolDef[]): Promise<SearchResult> {
  const s = q.toLowerCase(), by = (n: string) => tools.find((t) => t.name === n);
  let call: [string, any] | null = null;
  const month = MONTHS.findIndex((m) => s.includes(m)) + 1;
  const after = (re: RegExp) => q.match(re)?.[1]?.trim().replace(/[?.!]+$/, '');
  if (/expir/.test(s)) call = ['list_expired', { scope: /product|finished/.test(s) ? 'finished_goods' : 'all', withinDays: /within (\d+)/.exec(s) ? Number(/within (\d+)/.exec(s)![1]) : undefined }];
  else if (/invoice/.test(s)) call = ['search_invoices', { supplier: after(/from (?:supplier )?(.+)$/i) }];
  else if (/(used|using|consum)/.test(s) && /material/.test(s)) call = ['batches_by_material', { material: after(/material (.+)$/i) ?? '' }];
  else if (/stock|low|reorder/.test(s)) call = ['stock_status', { material: after(/(?:of|for) (.+)$/i), belowReorderOnly: /low|reorder/.test(s) }];
  else if (/batch/.test(s)) call = ['search_batches', { product: after(/show all (\w[\w\s]*?) batches/i), month: month || undefined }];
  const tool = call && by(call[0]);
  if (!tool || !call) return { answer: 'I can search batches, raw-material usage, expiries, invoices and stock. Try: "Show all Paracetamol batches produced in August". (Enable ANTHROPIC_API_KEY for free-form questions.)', tables: [], engine: 'rules', toolsUsed: [] };
  const t = await tool.run(call[1]);
  return { answer: `${t.rows.length} result(s) found.`, tables: [t], engine: 'rules', toolsUsed: [call[0]] };
}
