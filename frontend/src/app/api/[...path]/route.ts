/**
 * CATCH-ALL API ROUTE
 *
 * Two modes:
 *   • DEMO_MODE (default unless `DEMO_MODE=false` is set) — every endpoint the web app
 *     calls is served from the in-memory dataset. The handler itself lives in
 *     `@/lib/demo-api` so the exact same code can also run in the browser (see
 *     `@/lib/demo-fetch`), which is how the fully static GitHub Pages preview works.
 *   • Real backend — when `DEMO_MODE=false` is set, requests are forwarded verbatim to
 *     `BACKEND_URL` (the Express/Prisma API), so the original full-stack setup still works.
 */
import { NextRequest, NextResponse } from 'next/server';
import { handleDemo } from '@/lib/demo-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEMO_ENABLED = process.env.DEMO_MODE !== 'false';
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:4000';

// ------------------------------------------------------------------ entry
async function proxy(req: NextRequest, seg: string[]) {
  const url = `${BACKEND_URL}/api/${seg.join('/')}${req.nextUrl.search}`;
  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.delete('content-length');
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer();
  const res = await fetch(url, { method: req.method, headers, body });
  const out = new Headers(res.headers);
  out.delete('content-encoding');
  out.delete('content-length');
  return new NextResponse(res.body, { status: res.status, headers: out });
}

async function entry(req: NextRequest, ctx: { params: { path: string[] } }) {
  const seg = ctx.params.path ?? [];
  if (!DEMO_ENABLED) return proxy(req, seg);
  try { return await handleDemo(req, req.method.toUpperCase(), seg); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}

export const GET = entry;
export const POST = entry;
export const PUT = entry;
export const PATCH = entry;
export const DELETE = entry;
