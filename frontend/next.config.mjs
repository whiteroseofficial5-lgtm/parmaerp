/** @type {import('next').NextConfig} */
// Demo mode (the default) serves /api/* from the in-app demo route
// (src/app/api/[...path]/route.ts) using in-memory sample data — no backend needed.
// Set DEMO_MODE=false (+ BACKEND_URL) to proxy to the real Express/Prisma API instead.
const demo = process.env.DEMO_MODE !== 'false';
const backend = process.env.BACKEND_URL || 'http://localhost:4000';
export default {
  reactStrictMode: true,
  output: 'standalone',
  async rewrites() {
    if (demo) return [];
    // Same-origin API calls (no CORS, PDFs/downloads work with cookies-free bearer flow)
    return [{ source: '/api/:path*', destination: `${backend}/api/:path*` }];
  },
};
