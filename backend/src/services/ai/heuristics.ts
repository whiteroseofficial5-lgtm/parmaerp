import { BmrExtract, InvoiceExtract } from './schemas';

/** Regex-level extraction from OCR text. Deliberately conservative: it fills header fields only and lowers confidence. */
const toIso = (s?: string | null) => {
  if (!s) return null;
  const m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
};
const pick = (t: string, re: RegExp) => t.match(re)?.[1]?.trim() ?? null;
const numOf = (s: string | null) => (s ? Number(s.replace(/,/g, '')) : null);

export function heuristicInvoice(text: string): InvoiceExtract {
  return {
    invoiceNumber: pick(text, /invoice\s*(?:no|number|#)[\s.:\-]*([A-Z0-9\/\-]+)/i),
    invoiceDate: toIso(pick(text, /(?:invoice\s*)?date[\s.:\-]*([\d\/\-.]{6,10})/i)),
    supplierName: text.split('\n').map((l) => l.trim()).find((l) => l.length > 3) ?? null,
    supplierGstin: pick(text, /\b(\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/),
    items: [],
    total: numOf(pick(text, /(?:grand\s*)?total[\s.:\-₹Rs]*([\d,]+\.?\d*)\s*$/im)),
    fieldConfidence: { invoiceNumber: 0.5, invoiceDate: 0.5, supplierGstin: 0.7, total: 0.5 },
    illegibleFields: ['items (line-item parsing requires the AI vision extractor)'],
  };
}

export function heuristicBmr(text: string): BmrExtract {
  const status = /\b(passed|approved|released)\b/i.test(text) ? 'PASSED' : /\b(failed|rejected)\b/i.test(text) ? 'FAILED' : 'UNKNOWN';
  return {
    batchNumber: pick(text, /batch\s*(?:no|number|#)[\s.:\-]*([A-Z0-9\/\-]+)/i),
    productName: pick(text, /product(?:\s*name)?[\s.:\-]*([^\n]+)/i),
    manufacturingDate: toIso(pick(text, /(?:mfg|manufacturing)\.?\s*date[\s.:\-]*([\d\/\-.]{6,10})/i)),
    expiryDate: toIso(pick(text, /exp(?:iry)?\.?\s*date[\s.:\-]*([\d\/\-.]{6,10})/i)),
    batchSize: { value: numOf(pick(text, /batch\s*size[\s.:\-]*([\d,]+\.?\d*)/i)), unit: pick(text, /batch\s*size[\s.:\-]*[\d,]+\.?\d*\s*([A-Za-z]+)/i) },
    ingredients: [], qcStatus: status as BmrExtract['qcStatus'],
    operatorName: pick(text, /operator[\s.:\-]*([^\n]+)/i),
    fieldConfidence: { batchNumber: 0.5, productName: 0.4, manufacturingDate: 0.5, expiryDate: 0.5 },
    illegibleFields: ['ingredients', 'materialConsumption (require the AI vision extractor)'],
  };
}
