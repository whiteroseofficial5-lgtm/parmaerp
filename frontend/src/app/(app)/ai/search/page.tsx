'use client';
import { Search, Sparkles } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Empty, PageHeader, Panel, Spinner } from '@/components/ui/misc';
import { api } from '@/lib/api';

const EXAMPLES = ['Show all Paracetamol batches produced in August.', 'Which batches used Raw Material Starch?', 'Show all expired products.', 'Find all invoices from Supplier Gujarat.', 'Which materials are below reorder level?', 'Show stock expiring within 60 days.'];

export default function AiSearch() {
  const [q, setQ] = React.useState(''); const [busy, setBusy] = React.useState(false); const [res, setRes] = React.useState<any>(null); const [err, setErr] = React.useState('');
  const ask = async (text: string) => { if (text.trim().length < 3) return; setQ(text); setBusy(true); setErr(''); try { setRes(await api('/ai/search', { body: { question: text } })); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return (
    <>
      <PageHeader title="Ask the system" description="Ask in plain English. The assistant can only call fixed, read-only searches that respect your role — it never writes SQL." />
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="mb-3 flex gap-2"><div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Which batches used Raw Material XYZ?" className="h-10 pl-9" aria-label="Question" /></div><Button size="md" className="h-10" loading={busy}><Sparkles className="h-4 w-4" />Ask</Button></form>
      <div className="mb-6 flex flex-wrap gap-2">{EXAMPLES.map((e) => <button key={e} onClick={() => ask(e)} className="rounded-full border bg-card px-3 py-1 text-[0.8125rem] hover:bg-tint">{e}</button>)}</div>
      {err && <p role="alert" className="rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
      {busy && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Searching…</div>}
      {res && !busy && <div className="space-y-4">
        <p className="text-[0.9375rem]">{res.answer}<span className="ml-2 text-xs text-muted-foreground">({res.engine === 'claude' ? 'AI-interpreted' : 'keyword rules'}{res.toolsUsed.length ? ` · ${res.toolsUsed.join(', ')}` : ''})</span></p>
        {res.tables.map((t: any, i: number) => <Panel key={i} title={`${t.title} · ${t.rows.length} result${t.rows.length === 1 ? '' : 's'}`} flush>{t.rows.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr>{t.columns.map((c: string) => <th key={c} className="whitespace-nowrap px-3 py-2 font-semibold">{c}</th>)}</tr></thead><tbody>{t.rows.map((r: any[], j: number) => <tr key={j} className="border-t">{r.map((v, k) => <td key={k} className={`whitespace-nowrap px-3 py-1.5 ${k === 0 ? 'id-text' : ''}`}>{String(v ?? '')}</td>)}</tr>)}</tbody></table></div> : <Empty title="No matching records" />}</Panel>)}
      </div>}
    </>
  );
}
