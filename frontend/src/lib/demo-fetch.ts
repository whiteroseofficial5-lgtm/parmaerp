/**
 * BROWSER-SIDE DEMO API
 *
 * In the fully static build (GitHub Pages — no Node server to run the Next.js route
 * handler) there is nowhere for `/api/*` to go. This module swaps `window.fetch` for an
 * in-page implementation that answers those requests from `@/lib/demo-api` — the very
 * same handler the server-side route uses — so the deployed preview behaves exactly like
 * the server-rendered demo, including logins, mutations, PDFs and barcodes.
 *
 * It only activates when `NEXT_PUBLIC_STATIC_EXPORT=true`, so the normal server-rendered
 * build keeps talking to `/api/[...path]/route.ts` (and to the real backend when
 * `DEMO_MODE=false`).
 */
import { handleDemo } from './demo-api';

const API_MARKER = '/api/';
let installed = false;

function apiSegments(url: string): string[] | null {
  const parsed = new URL(url);
  const at = parsed.pathname.indexOf(API_MARKER);
  if (at === -1) return null;
  return parsed.pathname
    .slice(at + API_MARKER.length)
    .split('/')
    .filter(Boolean)
    .map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
}

export function installDemoFetch() {
  if (installed || typeof window === 'undefined') return;
  if (process.env.NEXT_PUBLIC_STATIC_EXPORT !== 'true') return;
  installed = true;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let req: Request;
    try {
      req = input instanceof Request
        ? new Request(input, init)
        : new Request(new URL(String(input), window.location.href).toString(), init);
    } catch {
      return nativeFetch(input as RequestInfo, init);
    }

    const segments = apiSegments(req.url);
    if (!segments || new URL(req.url).origin !== window.location.origin) return nativeFetch(input as RequestInfo, init);

    try {
      return await handleDemo(req, req.method.toUpperCase(), segments);
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  };
}

installDemoFetch();
