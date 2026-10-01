'use client';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { DEMO_MODE } from '@/components/demo-banner';

/** Surface the API's `details` (the underlying driver message) next to its `error`. */
function fullError(e: unknown) {
  const msg = (e as Error)?.message ?? 'Something went wrong';
  const detail = e instanceof ApiError && typeof e.details === 'string' ? e.details : undefined;
  return detail && !msg.includes(detail) ? `${msg} — ${detail}` : msg;
}

const DEMO = [
  ['Super admin', 'admin@pharma.local'], ['Production manager', 'production@pharma.local'], ['Warehouse manager', 'warehouse@pharma.local'], ['QC manager', 'qc@pharma.local'],
  ['Purchase manager', 'purchase@pharma.local'], ['Store operator', 'store@pharma.local'], ['Auditor', 'auditor@pharma.local'],
];

export default function Login() {
  const { login, user } = useAuth();
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (user) router.replace('/dashboard'); }, [user, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await login(email, password); router.replace('/dashboard'); } catch (e) { setErr(fullError(e)); } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2.5"><svg width="30" height="30" viewBox="0 0 26 26" aria-hidden><rect width="26" height="26" rx="6" fill="hsl(213 88% 45%)" /><path d="M8 8h6.5a3.5 3.5 0 010 7H11v3H8V8zm3 2.5v2h3a1 1 0 000-2h-3z" fill="#fff" /></svg><span className="text-lg font-semibold">PharmaERP</span></div>
        <div>
          <p className="max-w-md text-3xl font-semibold leading-tight">Every gram accounted for, from supplier lot to the patient's strip.</p>
          <p className="mt-4 max-w-md text-sm text-sidebar-muted">Lot-level inventory, controlled formulas, electronically signed batch records and full lot-to-batch traceability, with an audit trail on every change.</p>
        </div>
        <p className="text-xs text-sidebar-muted">Designed around GMP principles: segregation of duties, FEFO issue, quarantine-until-QC, immutable audit log.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Use your company account.</p>
          <div className="mt-2">
            {DEMO_MODE && <p className="mb-6 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">Demo mode — pick any account below. Password <span className="num">Pharma@12345</span>. This is sample data; changes are not saved.</p>}
            {!DEMO_MODE && <p className="mb-6" />}
          </div>
          <form onSubmit={submit} className="space-y-3">
            <div><Label htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div><Label htmlFor="pw">Password</Label><Input id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            {err && <p role="alert" className="rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
            <Button type="submit" className="w-full" loading={busy}>Sign in</Button>
          </form>
          <details className="mt-8 rounded border bg-card p-3 text-sm">
            <summary className="cursor-pointer font-medium">Demo accounts</summary>
            <p className="mt-2 text-xs text-muted-foreground">Password for all: <span className="num">Pharma@12345</span></p>
            <ul className="mt-2 space-y-1">{DEMO.map(([r, e]) => <li key={e}><button type="button" className="w-full rounded px-2 py-1 text-left hover:bg-muted" onClick={() => { setEmail(e); setPassword('Pharma@12345'); }}><span className="font-medium">{r}</span> <span className="text-muted-foreground">{e}</span></button></li>)}</ul>
          </details>
        </div>
      </div>
    </div>
  );
}
