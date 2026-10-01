'use client';

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: any) { super(message); }
}

const ACCESS = 'pe_access';
const REFRESH = 'pe_refresh';
// Set when the app is served from a sub-path (e.g. the static GitHub Pages preview).
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export const tokens = {
  get access() { return accessToken ?? (typeof window !== 'undefined' ? sessionStorage.getItem(ACCESS) : null); },
  set(access: string, refresh: string) { accessToken = access; sessionStorage.setItem(ACCESS, access); localStorage.setItem(REFRESH, refresh); },
  clear() { accessToken = null; sessionStorage.removeItem(ACCESS); localStorage.removeItem(REFRESH); },
  get refresh() { return typeof window !== 'undefined' ? localStorage.getItem(REFRESH) : null; },
};

async function tryRefresh(): Promise<boolean> {
  const rt = tokens.refresh;
  if (!rt) return false;
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) })
    .then(async (r) => { if (!r.ok) return false; const d = await r.json(); tokens.set(d.accessToken, d.refreshToken); return true; })
    .catch(() => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

type Opts = { method?: string; body?: unknown; query?: Record<string, unknown>; form?: FormData; raw?: boolean };

export async function api<T = any>(path: string, o: Opts = {}): Promise<T> {
  const qs = o.query ? '?' + new URLSearchParams(Object.entries(o.query).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => [k, String(v)])).toString() : '';
  const run = () => fetch(`/api${path}${qs}`, {
    method: o.method ?? (o.body || o.form ? 'POST' : 'GET'),
    headers: { ...(o.form ? {} : o.body ? { 'Content-Type': 'application/json' } : {}), ...(tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {}) },
    body: o.form ?? (o.body ? JSON.stringify(o.body) : undefined),
  });
  let res = await run();
  if (res.status === 401 && !['/auth/login', '/auth/refresh', '/auth/logout'].includes(path) && (await tryRefresh())) res = await run();
  if (res.status === 401 && !path.startsWith('/auth/login')) { tokens.clear(); if (typeof window !== 'undefined') window.location.href = `${BASE_PATH}/login`; }
  if (o.raw) return res as unknown as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText, data?.details);
  return data as T;
}

/** Fetch a protected binary (PDF/XLSX/PNG) with the bearer token and open or save it. */
export async function openFile(path: string, opts: { query?: Record<string, unknown>; download?: string } = {}) {
  const res = await api<Response>(path, { query: opts.query, raw: true });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new ApiError(res.status, d.error ?? 'Download failed'); }
  const url = URL.createObjectURL(await res.blob());
  if (opts.download) { const a = document.createElement('a'); a.href = url; a.download = opts.download; a.click(); }
  else window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function blobUrl(path: string): Promise<string> {
  const res = await api<Response>(path, { raw: true });
  return URL.createObjectURL(await res.blob());
}
