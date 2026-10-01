import type { Field } from './form-dialog';

export const MATERIAL_FIELDS: Field[] = [
  { name: 'code', label: 'Material code', required: true, half: true }, { name: 'name', label: 'Material name', required: true, half: true },
  { name: 'category', label: 'Category', type: 'select', required: true, half: true, options: ['API', 'EXCIPIENT', 'COATING', 'SOLVENT', 'PACKAGING', 'OTHER'].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() })) },
  { name: 'uom', label: 'Unit of measure', required: true, half: true, placeholder: 'KG, G, L, ML, NOS', defaultValue: 'KG' },
  { name: 'minStock', label: 'Minimum stock', type: 'number', half: true, defaultValue: 0 }, { name: 'reorderLevel', label: 'Reorder level', type: 'number', half: true, defaultValue: 0 },
  { name: 'purchasePrice', label: 'Purchase price (₹ / unit)', type: 'number', half: true, defaultValue: 0 }, { name: 'shelfLifeMonths', label: 'Shelf life (months)', type: 'number', half: true },
  { name: 'defaultSupplierId', label: 'Default supplier', type: 'select', half: true, optionsFrom: { endpoint: '/suppliers', label: (r) => r.name } }, { name: 'storageCondition', label: 'Storage condition', half: true },
  { name: 'hsnCode', label: 'HSN code', half: true }, { name: 'gstRate', label: 'GST %', type: 'number', half: true },
];
