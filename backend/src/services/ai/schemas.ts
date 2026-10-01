const str = { type: ['string', 'null'] } as const;
const nul = (t: string) => ({ type: [t, 'null'] });

export const BMR_SCHEMA = {
  type: 'object',
  properties: {
    batchNumber: str, productName: str, productCode: str,
    manufacturingDate: { ...str, description: 'YYYY-MM-DD' }, expiryDate: { ...str, description: 'YYYY-MM-DD' },
    batchSize: { type: 'object', properties: { value: nul('number'), unit: str }, required: ['value', 'unit'] },
    formulaVersion: str,
    ingredients: {
      type: 'array', description: 'Ingredients as listed in the master formula / dispensing section',
      items: { type: 'object', properties: { name: { type: 'string' }, code: str, quantity: nul('number'), unit: str, lotNumber: str }, required: ['name', 'quantity', 'unit'] },
    },
    materialConsumption: {
      type: 'array', description: 'Actual issued/consumed quantities recorded during manufacturing',
      items: { type: 'object', properties: { name: { type: 'string' }, plannedQty: nul('number'), actualQty: nul('number'), unit: str, lotNumber: str }, required: ['name', 'actualQty', 'unit'] },
    },
    operatorName: str, supervisorName: str,
    qcStatus: { type: 'string', enum: ['PASSED', 'FAILED', 'PENDING', 'UNKNOWN'] },
    yield: { type: 'object', properties: { theoretical: nul('number'), actual: nul('number'), unit: str, percent: nul('number') } },
    remarks: str,
    fieldConfidence: { type: 'object', additionalProperties: { type: 'number' } },
    illegibleFields: { type: 'array', items: { type: 'string' } },
  },
  required: ['batchNumber', 'productName', 'ingredients', 'qcStatus'],
};

export const INVOICE_SCHEMA = {
  type: 'object',
  properties: {
    invoiceNumber: str, invoiceDate: { ...str, description: 'YYYY-MM-DD' },
    supplierName: str, supplierGstin: str, buyerGstin: str, poReference: str, currency: str,
    items: {
      type: 'array',
      items: { type: 'object', properties: { description: { type: 'string' }, hsnCode: str, quantity: nul('number'), unit: str, unitPrice: nul('number'), taxPct: nul('number'), amount: nul('number'), lotNumber: str, expiryDate: str }, required: ['description', 'quantity', 'unitPrice', 'amount'] },
    },
    subtotal: nul('number'),
    tax: { type: 'object', properties: { cgst: nul('number'), sgst: nul('number'), igst: nul('number'), total: nul('number') } },
    total: nul('number'),
    fieldConfidence: { type: 'object', additionalProperties: { type: 'number' } },
    illegibleFields: { type: 'array', items: { type: 'string' } },
  },
  required: ['invoiceNumber', 'invoiceDate', 'supplierName', 'items', 'total'],
};

export interface BmrExtract {
  batchNumber: string | null; productName: string | null; productCode?: string | null; manufacturingDate: string | null; expiryDate: string | null;
  batchSize?: { value: number | null; unit: string | null }; formulaVersion?: string | null;
  ingredients: { name: string; code?: string | null; quantity: number | null; unit: string | null; lotNumber?: string | null }[];
  materialConsumption?: { name: string; plannedQty?: number | null; actualQty: number | null; unit: string | null; lotNumber?: string | null }[];
  operatorName?: string | null; supervisorName?: string | null; qcStatus: 'PASSED' | 'FAILED' | 'PENDING' | 'UNKNOWN';
  yield?: { theoretical?: number | null; actual?: number | null; unit?: string | null; percent?: number | null };
  remarks?: string | null; fieldConfidence?: Record<string, number>; illegibleFields?: string[];
}

export interface InvoiceExtract {
  invoiceNumber: string | null; invoiceDate: string | null; supplierName: string | null; supplierGstin?: string | null; buyerGstin?: string | null; poReference?: string | null; currency?: string | null;
  items: { description: string; hsnCode?: string | null; quantity: number | null; unit?: string | null; unitPrice: number | null; taxPct?: number | null; amount: number | null; lotNumber?: string | null; expiryDate?: string | null }[];
  subtotal?: number | null; tax?: { cgst?: number | null; sgst?: number | null; igst?: number | null; total?: number | null }; total: number | null;
  fieldConfidence?: Record<string, number>; illegibleFields?: string[];
}

/** Average of reported per-field confidences; 0.5 if the model reported none. */
export const overallConfidence = (fc?: Record<string, number>) => {
  const v = Object.values(fc ?? {}).filter((x) => typeof x === 'number');
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0.5;
};
