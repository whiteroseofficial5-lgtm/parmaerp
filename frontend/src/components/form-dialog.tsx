'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { Button } from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';
import { Input, Label, Select, Textarea } from './ui/input';

export interface Field {
  name: string; label: string; type?: 'text' | 'number' | 'date' | 'select' | 'textarea' | 'checkbox' | 'password' | 'email' | 'datetime-local';
  required?: boolean; placeholder?: string; hint?: string; half?: boolean; step?: string;
  options?: { value: string; label: string }[];
  optionsFrom?: { endpoint: string; label: (r: any) => string; value?: string; query?: Record<string, unknown> };
  defaultValue?: any;
}

export function useOptions(from?: Field['optionsFrom']) {
  const { data } = useQuery({
    queryKey: ['options', from?.endpoint, from?.query],
    enabled: !!from,
    staleTime: 60_000,
    queryFn: async () => {
      const r = await api<any>(from!.endpoint, { query: { pageSize: 200, ...from!.query } });
      const rows = Array.isArray(r) ? r : r.data;
      return rows.map((x: any) => ({ value: x[from!.value ?? 'id'], label: from!.label(x) })) as { value: string; label: string }[];
    },
  });
  return data ?? [];
}

function FieldInput({ f, value, onChange }: { f: Field; value: any; onChange: (v: any) => void }) {
  const opts = useOptions(f.optionsFrom);
  const common = { id: f.name, required: f.required, placeholder: f.placeholder };
  if (f.type === 'select') {
    return (
      <Select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">{f.required ? 'Select…' : '— none —'}</option>
        {(f.options ?? opts).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    );
  }
  if (f.type === 'textarea') return <Textarea {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  if (f.type === 'checkbox') return <input id={f.name} type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
  return <Input {...common} type={f.type ?? 'text'} step={f.type === 'number' ? f.step ?? 'any' : undefined} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
}

interface Props {
  title: string; description?: string; fields: Field[]; open: boolean; onOpenChange: (o: boolean) => void;
  initial?: Record<string, any>; submitLabel?: string; invalidate?: string[];
  onSubmit: (values: Record<string, any>) => Promise<unknown>;
  wide?: boolean; children?: (values: Record<string, any>, set: (k: string, v: any) => void) => React.ReactNode;
}

/** Declarative form in a dialog: typed fields, dynamic option lists, error toasts, cache invalidation. */
export function FormDialog({ title, description, fields, open, onOpenChange, initial, submitLabel = 'Save', invalidate, onSubmit, wide, children }: Props) {
  const qc = useQueryClient();
  const [values, setValues] = React.useState<Record<string, any>>({});
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) { setValues({ ...Object.fromEntries(fields.map((f) => [f.name, f.defaultValue ?? (f.type === 'checkbox' ? false : '')])), ...initial }); setErr(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (k: string, v: any) => setValues((s) => ({ ...s, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '' && v !== undefined));
      await onSubmit(clean);
      (invalidate ?? []).forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(`${title} — saved`);
      onOpenChange(false);
    } catch (e) {
      const ex = e as ApiError;
      const d = ex.details?.fieldErrors ? Object.entries(ex.details.fieldErrors).map(([k, v]) => `${k}: ${(v as string[]).join(', ')}`).join(' · ') : Array.isArray(ex.details) ? ex.details.join(' · ') : '';
      setErr([ex.message, d].filter(Boolean).join(' — '));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description} wide={wide}>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.name} className={f.half || f.type === 'checkbox' ? '' : 'sm:col-span-2'}>
                {f.type === 'checkbox' ? (
                  <label className="flex items-center gap-2 text-sm"><FieldInput f={f} value={values[f.name]} onChange={(v) => set(f.name, v)} />{f.label}</label>
                ) : (
                  <><Label htmlFor={f.name}>{f.label}{f.required && <span className="text-danger"> *</span>}</Label><FieldInput f={f} value={values[f.name]} onChange={(v) => set(f.name, v)} /></>
                )}
                {f.hint && <p className="mt-1 text-xs text-muted-foreground">{f.hint}</p>}
              </div>
            ))}
          </div>
          {children?.(values, set)}
          {err && <p role="alert" className="rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={busy}>{submitLabel}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Convenience: run a mutation with toast + invalidation (for one-click actions). */
export function useAction() {
  const qc = useQueryClient();
  return async (fn: () => Promise<unknown>, o: { ok?: string; invalidate?: string[] } = {}) => {
    try { await fn(); if (o.ok) toast.success(o.ok); (o.invalidate ?? []).forEach((k) => qc.invalidateQueries({ queryKey: [k] })); return true; }
    catch (e) { toast.error((e as Error).message); return false; }
  };
}
