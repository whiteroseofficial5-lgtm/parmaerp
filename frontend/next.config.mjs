/** @type {import('next').NextConfig} */
// Demo mode (the default) serves /api/* from the in-app demo data — no backend, no database.
// Set DEMO_MODE=false (+ BACKEND_URL) to proxy to the real Express/Prisma API instead.
const demo = process.env.DEMO_MODE !== 'false';
const backend = process.env.BACKEND_URL || 'http://localhost:4000';

// Static export: `npm run build:static` (used by the GitHub Pages workflow). There is no
// Node server to run the API route, so the browser answers /api/* itself via
// src/lib/demo-fetch.ts. NEXT_PUBLIC_BASE_PATH is required when hosting under a sub-path,
// e.g. /parmaerp for a project page on github.io.
const isStatic = process.env.STATIC_EXPORT === 'true' || process.env.NEXT_PUBLIC_STATIC_EXPORT === 'true';
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const config = {
  reactStrictMode: true,
  ...(isStatic
    ? {
        output: 'export',
        basePath,
        assetPrefix: basePath || undefined,
        // Emit `route/index.html` so static hosts resolve /route and /route/ alike.
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : { output: 'standalone' }),
};

// A static export has no server to proxy through (and custom routes are unsupported), so
// only the server builds declare rewrites.
if (!isStatic) {
  // Same-origin API calls (no CORS, PDFs/downloads work with the bearer-token flow)
  config.rewrites = async () => (demo ? [] : [{ source: '/api/:path*', destination: `${backend}/api/:path*` }]);
}

export default config;
