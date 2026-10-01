'use client';
import * as React from 'react';
import { FormDialog, Field } from './form-dialog';
import { Dialog, DialogContent } from './ui/dialog';
import { api, blobUrl } from '@/lib/api';

const WH = { endpoint: '/warehouses', label: (r: any) => `${r.code} · ${r.name}` };
const MAT = { endpoint: '/raw-materials', label: (r: any) => `${r.code} · ${r.name} (${r.uom})` };

export function ReceiveDialog({ open, onOpenChange, materialId }: { open: boolean; onOpenChange: (o: boolean) => void; materialId?: string }) {
  const fields: Field[] = [
    { name: 'rawMaterialId', label: 'Raw material', type: 'select', required: true, optionsFrom: MAT },
    { name: 'lotNumber', label: 'Internal lot number', required: true, half: true }, { name: 'supplierLot', label: 'Supplier batch no.', half: true },
    { name: 'supplierId', label: 'Supplier', type: 'select', optionsFrom: { endpoint: '/suppliers', label: (r) => r.name }, half: true },
    { name: 'warehouseId', label: 'Warehouse', type: 'select', required: true, optionsFrom: WH, half: true },
    { name: 'quantity', label: 'Quantity', type: 'number', required: true, half: true }, { name: 'unitCost', label: 'Unit cost (₹)', type: 'number', required: true, half: true },
    { name: 'mfgDate', label: 'Mfg date', type: 'date', half: true }, { name: 'expiryDate', label: 'Expiry date', type: 'date', half: true, hint: 'Leave blank to derive from shelf life' },
    { name: 'reason', label: 'Reference / reason', required: true, placeholder: 'e.g. Opening balance, returned from lab' },
  ];
  return <FormDialog title="Stock in — receive lot" description="Received lots enter QUARANTINE until QC approves them. Supplier deliveries should normally go through a GRN." fields={fields} open={open} onOpenChange={onOpenChange} initial={{ rawMaterialId: materialId }} invalidate={['/raw-materials', '/inventory/lots', '/dashboard']} onSubmit={(v) => api('/inventory/receive', { body: v })} submitLabel="Receive stock" />;
}

export function IssueDialog({ open, onOpenChange, materialId }: { open: boolean; onOpenChange: (o: boolean) => void; materialId?: string }) {
  const fields: Field[] = [
    { name: 'rawMaterialId', label: 'Raw material', type: 'select', required: true, optionsFrom: MAT },
    { name: 'quantity', label: 'Quantity', type: 'number', required: true, half: true },
    { name: 'type', label: 'Type', type: 'select', half: true, options: [{ value: 'ISSUE', label: 'Issue (lab / other use)' }, { value: 'RETURN', label: 'Return to supplier' }, { value: 'WRITE_OFF', label: 'Write-off / scrap' }], defaultValue: 'ISSUE' },
    { name: 'reason', label: 'Reason', required: true },
  ];
  return <FormDialog title="Stock out" description="Stock is issued first-expiry-first-out from approved, unexpired lots." fields={fields} open={open} onOpenChange={onOpenChange} initial={{ rawMaterialId: materialId }} invalidate={['/raw-materials', '/inventory/lots', '/dashboard']} onSubmit={(v) => api('/inventory/issue', { body: v })} submitLabel="Issue stock" />;
}

export function TransferDialog({ lot, onClose }: { lot: any | null; onClose: () => void }) {
  return (
    <FormDialog title={`Transfer lot ${lot?.lotNumber ?? ''}`} description={lot ? `${lot.rawMaterial?.name ?? ''} · available ${lot.availableQty}` : undefined} open={!!lot} onOpenChange={(o) => !o && onClose()} invalidate={['/raw-materials', '/inventory/lots', '/inventory/ledger']}
      fields={[{ name: 'toWarehouseId', label: 'Destination warehouse', type: 'select', required: true, optionsFrom: WH }, { name: 'toBinId', label: 'Destination bin', type: 'select', optionsFrom: { endpoint: '/bins', label: (r) => r.code } }, { name: 'quantity', label: 'Quantity (blank = whole lot)', type: 'number', hint: 'A partial transfer splits the lot and keeps traceability to the parent.' }]}
      onSubmit={(v) => api('/inventory/transfer', { body: { materialLotId: lot.id, ...v } })} submitLabel="Transfer" />
  );
}

export function AdjustDialog({ lot, onClose }: { lot: any | null; onClose: () => void }) {
  return (
    <FormDialog title={`Adjust lot ${lot?.lotNumber ?? ''}`} description={lot ? `System quantity: ${lot.availableQty} ${lot.rawMaterial?.uom ?? ''}. Every adjustment is audited and needs a reason.` : undefined} open={!!lot} onOpenChange={(o) => !o && onClose()} invalidate={['/raw-materials', '/inventory/lots', '/inventory/ledger']}
      fields={[{ name: 'newQuantity', label: 'Corrected quantity', type: 'number', required: true }, { name: 'reason', label: 'Reason for adjustment', type: 'textarea', required: true }]}
      onSubmit={(v) => api('/inventory/adjust', { body: { materialLotId: lot.id, ...v } })} submitLabel="Post adjustment" />
  );
}

/** Printable QR label for a lot (encodes LOT|material|lot so scanners resolve it). */
export function LabelDialog({ lot, onClose }: { lot: any | null; onClose: () => void }) {
  const [src, setSrc] = React.useState<string>();
  React.useEffect(() => { setSrc(undefined); if (lot) blobUrl(`/scan/label?code=${encodeURIComponent(lot.barcode ?? `LOT|${lot.rawMaterial?.code}|${lot.lotNumber}`)}`).then(setSrc).catch(() => undefined); }, [lot]);
  return (
    <Dialog open={!!lot} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Lot label" description="Print and attach to the container.">
        {lot && (
          <div className="mx-auto w-72 rounded border-2 border-foreground p-3 text-sm print:border-black">
            <div className="text-xs">{lot.rawMaterial?.code}</div>
            <div className="text-base font-semibold leading-tight">{lot.rawMaterial?.name}</div>
            <div className="mt-1 flex items-center gap-3">{src && <img src={src} alt="Lot QR code" className="h-24 w-24" />}<div className="num space-y-0.5 text-xs"><div>Lot: <b>{lot.lotNumber}</b></div><div>Exp: <b>{lot.expiryDate ? new Date(lot.expiryDate).toLocaleDateString('en-GB') : '—'}</b></div><div>Qty: <b>{lot.availableQty} {lot.rawMaterial?.uom}</b></div><div>Status: <b>{lot.status}</b></div></div></div>
          </div>
        )}
        <div className="mt-4 flex justify-end"><button className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground" onClick={() => window.print()}>Print label</button></div>
      </DialogContent>
    </Dialog>
  );
}
