#!/usr/bin/env node
/**
 * Builds a fully static copy of the frontend, for hosts that cannot run a Node server
 * (the GitHub Pages preview). `output: 'export'` refuses to build while API route handlers
 * exist, so the server-only route is parked for the duration of the build and restored
 * afterwards. Nothing is lost: in the static build the browser answers /api/* itself via
 * src/lib/demo-fetch.ts, using the same handler the route calls.
 */
import { execSync } from 'node:child_process';
import { existsSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = resolve(root, 'src/app/api');
const parked = resolve(root, '.api-server-only');

if (existsSync(parked)) {
  throw new Error(`Refusing to build: ${parked} already exists — a previous run did not finish. Delete it and retry.`);
}

let moved = false;
if (existsSync(apiDir)) {
  renameSync(apiDir, parked);
  moved = true;
}

try {
  execSync('next build', { cwd: root, stdio: 'inherit', env: { ...process.env, STATIC_EXPORT: 'true' } });
} finally {
  if (moved) renameSync(parked, apiDir);
}
