'use client';
import { Camera, ScanLine } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';
import { Input } from './ui/input';

/** Resolve a scanned/typed code (lot, material, bin, batch QR) and jump to the record. */
export function useResolveScan() {
  const router = useRouter();
  return async (code: string) => {
    try {
      const r = await api<{ type: string; data: any }>('/scan/resolve', { query: { code } });
      if (r.type === 'LOT') router.push(`/raw-materials/${r.data.rawMaterialId}`);
      else if (r.type === 'MATERIAL') router.push(`/raw-materials/${r.data.id}`);
      else if (r.type === 'BATCH') router.push(`/batches/${r.data.id}`);
      else if (r.type === 'BIN') toast.info(`Bin ${r.data.code} · ${r.data.warehouse.name} — ${r.data.materialLots.length} lot(s) stored`);
    } catch (e) { toast.error((e as Error).message); }
  };
}

/**
 * Keyboard-wedge scanners type the code then press Enter, so a plain input works out of the box.
 * On phones, the camera button uses the native BarcodeDetector API (Chrome/Android/Safari 17+) where available.
 */
export function ScanBox() {
  const [v, setV] = React.useState('');
  const [cam, setCam] = React.useState(false);
  const resolve = useResolveScan();
  const ref = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); ref.current?.focus(); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <>
      <form className="relative hidden w-72 md:block" onSubmit={(e) => { e.preventDefault(); if (v.trim()) { resolve(v.trim()); setV(''); } }}>
        <ScanLine className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input ref={ref} value={v} onChange={(e) => setV(e.target.value)} placeholder="Scan or type a lot / batch code   ( / )" className="pl-8" aria-label="Scan code" />
      </form>
      <Button variant="ghost" size="icon" onClick={() => setCam(true)} aria-label="Scan with camera"><Camera className="h-4 w-4" /></Button>
      <Dialog open={cam} onOpenChange={setCam}><DialogContent title="Scan with camera" description="Point at a lot label, bin label or batch QR code."><CameraScan onCode={(c) => { setCam(false); resolve(c); }} /></DialogContent></Dialog>
    </>
  );
}

function CameraScan({ onCode }: { onCode: (c: string) => void }) {
  const video = React.useRef<HTMLVideoElement>(null);
  const [msg, setMsg] = React.useState('Starting camera…');
  React.useEffect(() => {
    let stop = false; let stream: MediaStream | undefined;
    (async () => {
      const BD = (window as any).BarcodeDetector;
      if (!BD) return setMsg('Camera scanning is not supported in this browser. Use a handheld scanner or type the code.');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (video.current) { video.current.srcObject = stream; await video.current.play(); }
        setMsg('Scanning…');
        const det = new BD({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'data_matrix'] });
        const tick = async () => {
          if (stop || !video.current) return;
          const found = await det.detect(video.current).catch(() => []);
          if (found[0]?.rawValue) return onCode(found[0].rawValue);
          setTimeout(tick, 250);
        };
        tick();
      } catch { setMsg('Camera permission denied or unavailable.'); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [onCode]);
  return <div><video ref={video} className="aspect-video w-full rounded bg-black object-cover" muted playsInline /><p className="mt-2 text-sm text-muted-foreground">{msg}</p></div>;
}
