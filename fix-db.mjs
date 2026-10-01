#!/usr/bin/env node
/* fix-db.mjs — PowerShell-free database bootstrap for the PharmaERP preview.
 *
 *   cd E:\pharmaerp\pharmaerp
 *   node fix-db.mjs
 *   node fix-db.mjs --superuser=myadmin             (if your PostgreSQL superuser is not "postgres")
 *   node fix-db.mjs --reset-superuser               (forgot the password? run in an Administrator cmd)
 *
 * Uses the bundled Docker database when Docker is available, otherwise creates the missing `pharma`
 * role on the PostgreSQL already running on localhost:5432 (asks for that server's superuser password).
 * Then pushes the Prisma schema, loads the demo data and verifies the result.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const backend = path.join(root, 'backend');
const envFile = path.join(backend, '.env');
const appUrl = (port) => `postgresql://pharma:pharma@localhost:${port}/`;

const run = (cmd, cwd = root, env) => {
  console.log(`\n> ${cmd}`);
  const r = spawnSync(cmd, { cwd, stdio: 'inherit', shell: true, env: { ...process.env, ...(env ?? {}) } });
  if (r.error) throw r.error;
  return r.status ?? 1;
};

const runOrThrow = (cmd, cwd = root, env) => {
  const code = run(cmd, cwd, env);
  if (code !== 0) throw new Error(`command failed (exit ${code}): ${cmd}`);
};

/** Rewrite DATABASE_URL in backend/.env, keeping the file's other lines intact. */
function setDatabaseUrl(url) {
  let text = fs.readFileSync(envFile, 'utf8');
  text = /^DATABASE_URL=/m.test(text)
    ? text.replace(/^DATABASE_URL=[^\r\n]*/m, `DATABASE_URL=${url}`)
    : `${text.replace(/\s*$/, '')}\r\nDATABASE_URL=${url}\r\n`;
  fs.writeFileSync(envFile, text, 'utf8');
  console.log(`  backend/.env  DATABASE_URL=${url}`);
  return url;
}

/** Load the backend's own Prisma client + dotenv, exactly like the API does. */
function prisma() {
  const req = createRequire(path.join(backend, 'package.json'));
  req('dotenv').config({ path: envFile });
  return req('@prisma/client').PrismaClient;
}

/** Run SQL through the Prisma CLI with a temporary DATABASE_URL (the password never hits the command line). */
function executeSql(sql, url) {
  const file = path.join(os.tmpdir(), `pharmaerp-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(file, sql, 'utf8');
  try {
    return run(`npx prisma db execute --file ${JSON.stringify(file)} --schema prisma/schema.prisma`, backend, { DATABASE_URL: url });
  } finally {
    fs.unlinkSync(file);
  }
}

const ask = (q) => new Promise((res) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => { rl.close(); res(a); });
});

const dockerAvailable = () =>
  spawnSync('docker version --format "{{.Server.Version}}"', { shell: true, stdio: 'ignore' }).status === 0;

/** Best-effort: locate pg_hba.conf so the password-reset recipe can name the exact file. */
function findPgHba() {
  const base = 'C:\\Program Files\\PostgreSQL';
  try {
    for (const v of fs.readdirSync(base).sort().reverse()) {
      const f = path.join(base, v, 'data', 'pg_hba.conf');
      if (fs.existsSync(f)) return f;
    }
  } catch { /* not a native install, or no access */ }
  return 'C:\\Program Files\\PostgreSQL\\<version>\\data\\pg_hba.conf';
}

// ── --reset-superuser: recover a forgotten PostgreSQL password without knowing it ───────────────
const isAdmin = () => spawnSync('net session', { shell: true, stdio: 'ignore' }).status === 0;

function findDataDir() {
  const base = 'C:\\Program Files\\PostgreSQL';
  try {
    for (const v of fs.readdirSync(base).sort().reverse()) {
      const d = path.join(base, v, 'data');
      if (fs.existsSync(path.join(d, 'pg_hba.conf'))) return d;
    }
  } catch { /* not a native install, or no access */ }
  return null;
}

function findService() {
  const out = spawnSync('sc query state= all', { shell: true, encoding: 'utf8' }).stdout || '';
  return [...out.matchAll(/SERVICE_NAME:\s*(\S+)/gi)].map((m) => m[1]).filter((n) => /postgres/i.test(n))[0] || null;
}

function restartService(name) {
  run(`net stop "${name}"`, root);
  if (run(`net start "${name}"`, root) !== 0) console.log(`  WARNING: could not start "${name}" — please start it manually.`);
}

/** Temporarily trust local connections, set the pharma role's password, then restore pg_hba.conf. */
function resetSuperuser() {
  if (!isAdmin()) throw new Error('--reset-superuser needs an Administrator cmd window (Start > type "cmd" > right-click > Run as administrator).');
  const dataDir = findDataDir();
  if (!dataDir) throw new Error('No native PostgreSQL data directory under C:\\Program Files\\PostgreSQL\\<version>\\data. If your server runs in Docker, plain "node fix-db.mjs" is enough.');
  const service = findService();
  if (!service) throw new Error('No PostgreSQL Windows service found. If your server runs in Docker, plain "node fix-db.mjs" is enough.');

  const hba = path.join(dataDir, 'pg_hba.conf');
  const original = fs.readFileSync(hba, 'utf8');
  fs.writeFileSync(`${hba}.bak-pharmaerp`, original, 'utf8');
  console.log(`  data dir : ${dataDir}`);
  console.log(`  service  : ${service}`);
  console.log(`  backup   : ${hba}.bak-pharmaerp`);

  const relaxed = original.replace(/^(\s*host\s+all\s+all\s+(?:127\.0\.0\.1\/32|::1\/128)\s+)(?:scram-sha-256|md5|password)/gim, '$1trust');
  if (relaxed !== original) {
    fs.writeFileSync(hba, relaxed, 'utf8');
    console.log('  pg_hba.conf: loopback auth temporarily changed to "trust"');
  }

  let url = null;
  try {
    restartService(service);
    const trust = 'postgresql://postgres:trusted@localhost:5432/postgres?schema=public';
    if (executeSql('SELECT 1;', trust) !== 0) throw new Error('still no connection with trust auth — was the service really restarted (Administrator window)?');
    executeSql("CREATE ROLE pharma LOGIN PASSWORD 'pharma' CREATEDB;", trust);
    executeSql("ALTER ROLE pharma WITH PASSWORD 'pharma' CREATEDB;", trust);   // also fixes an existing pharma role
    console.log('  role "pharma" ready (password: pharma)');
    if (executeSql('CREATE DATABASE pharmaerp OWNER pharma;', trust) === 0) {
      url = `${appUrl(5432)}pharmaerp?schema=public`;
    } else {
      console.log('  could not create database "pharmaerp" — granting on the existing "postgres" database instead');
      executeSql('GRANT ALL ON DATABASE postgres TO pharma; GRANT ALL ON SCHEMA public TO pharma;', trust);
      url = `${appUrl(5432)}postgres?schema=public`;
    }
  } finally {
    fs.writeFileSync(hba, original, 'utf8');
    restartService(service);
    console.log('  pg_hba.conf restored to its original content');
  }
  return setDatabaseUrl(url);
}

async function main() {
  if (!fs.existsSync(envFile)) throw new Error(`Missing ${envFile} — copy backend\\.env.example to backend\\.env first.`);

  const PrismaClient = prisma();
  // Pass an explicit URL when we have just changed .env, because dotenv never overwrites an
  // already-set process.env value and PrismaClient reads the datasource URL at construction.
  const probe = async (url) => {
    const db = url ? new PrismaClient({ datasources: { db: { url } } }) : new PrismaClient();
    try { return { ok: true, users: await db.user.count() }; }
    catch (e) { return { ok: false, why: String(e.message).split('\n').map((l) => l.trim()).filter(Boolean).pop() }; }
    finally { await db.$disconnect(); }
  };

  console.log('PharmaERP database setup');
  let chosenUrl = null;
  if (process.argv.includes('--reset-superuser')) chosenUrl = resetSuperuser();
  const before = await probe(chosenUrl);
  if (before.ok) {
    console.log(`  Already connected — table "User" has ${before.users} row(s).`);
    if (before.users === 0) {
      console.log('  Loading the demo data ...');
      runOrThrow('npm run seed', backend);
    }
  } else {
    if (!chosenUrl) console.log(`  Current DATABASE_URL does not work: ${before.why}`);

    if (chosenUrl) {
      console.log('  credentials were created by --reset-superuser — loading the schema next');
    } else if (dockerAvailable()) {
      console.log('\n[1/3] Docker is available — starting the bundled PostgreSQL on host port 5433 ...');
      runOrThrow('docker compose up -d db', root);
      let ready = false;
      for (let i = 0; i < 40 && !ready; i++) {
        ready = spawnSync('docker compose exec -T db pg_isready -U pharma', { cwd: root, shell: true, stdio: 'ignore' }).status === 0;
        if (!ready) await new Promise((r) => setTimeout(r, 2000));
      }
      if (!ready) throw new Error('The db container never became ready — inspect it with: docker compose logs db');
      chosenUrl = setDatabaseUrl(`${appUrl(5433)}pharmaerp?schema=public`);
    } else {
      const arg = process.argv.find((a) => a.startsWith('--superuser='));
      const superuser = arg ? arg.slice('--superuser='.length) : 'postgres';
      console.log(`\n[1/3] Docker is not available — using your PostgreSQL on localhost:5432 (superuser "${superuser}").`);
      const password = (await ask(`  Password for PostgreSQL superuser "${superuser}": `)).trim();
      if (!password) throw new Error('No password entered — nothing to do.');
      const asSuper = (db) => `postgresql://${encodeURIComponent(superuser)}:${encodeURIComponent(password)}@localhost:5432/${db}?schema=public`;

      if (executeSql('SELECT 1;', asSuper('postgres')) !== 0) {
        const hba = findPgHba();
        throw new Error([
          `could not log in as "${superuser}" on localhost:5432 — that password or user name is not accepted.`,
          '',
          '  a) If you know the correct password, just re-run and type it (nothing is stored):',
          '        node fix-db.mjs',
          '     or name a different superuser:',
          '        node fix-db.mjs --superuser=<name>',
          '',
          '  b) Easiest, no password at all: install/start Docker Desktop and re-run "node fix-db.mjs" —',
          '     it then uses the bundled PostgreSQL on port 5433.',
          '',
          '  c) Forgot the password? Recover it WITHOUT knowing it — open an Administrator cmd',
          '     (Start > type "cmd" > right-click > Run as administrator) and run:',
          '        node fix-db.mjs --reset-superuser',
          '     That temporarily sets loopback auth to "trust" in',
          `        ${hba}`,
          '     sets the pharma role password, then restores the original file and restarts the service.',
        ].join('\n'));
      }
      if (executeSql("CREATE ROLE pharma LOGIN PASSWORD 'pharma' CREATEDB;", asSuper('postgres')) !== 0) {
        console.log('  role "pharma" already exists (or was not created) — continuing');
      } else {
        console.log('  created role "pharma"');
      }
      if (executeSql('CREATE DATABASE pharmaerp OWNER pharma;', asSuper('postgres')) === 0) {
        console.log('  created database "pharmaerp"');
        chosenUrl = setDatabaseUrl(`${appUrl(5432)}pharmaerp?schema=public`);
      } else {
        console.log('  could not create database "pharmaerp" — reusing the existing "postgres" database instead');
        executeSql('GRANT ALL ON DATABASE postgres TO pharma; GRANT ALL ON SCHEMA public TO pharma;', asSuper('postgres'));
        chosenUrl = setDatabaseUrl(`${appUrl(5432)}postgres?schema=public`);
      }
    }

    console.log('\n[2/3] Pushing the Prisma schema and loading the demo data ...');
    runOrThrow('npx prisma generate', backend);
    runOrThrow('npx prisma db push --skip-generate', backend);
    runOrThrow('npm run seed', backend);

    console.log('\n[3/3] Verifying ...');
    const after = await probe(chosenUrl);
    if (!after.ok) throw new Error(`still not usable: ${after.why}`);
    console.log(`  OK — table "User" has ${after.users} row(s).`);
  }

  console.log('\nReady. Start the app in two separate windows — this is cmd syntax, use && (not ;):');
  console.log('  cd /d E:\\pharmaerp\\pharmaerp\\backend  &&  npm run dev     ::  http://localhost:4000');
  console.log('  cd /d E:\\pharmaerp\\pharmaerp\\frontend &&  npm run dev     ::  http://localhost:3000');
  console.log('Press Ctrl+C in any window already running a dev server first — .env is read only at start-up.');
  console.log('Sign in at http://localhost:3000 with  admin@pharma.local / Pharma@12345');
}

main().catch((e) => { console.error(`\nERROR: ${e.message}`); process.exit(1); });
