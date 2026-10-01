import { createApp } from './app';
import { env } from './config/env';
import { startScheduler } from './jobs/scheduler';
import { basePrisma } from './lib/prisma';

/** Host + database from DATABASE_URL, password omitted, for log output. */
function describeDatabase() {
  try {
    const u = new URL(env.DATABASE_URL);
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return 'DATABASE_URL';
  }
}

/**
 * Check connectivity at boot so a wrong DATABASE_URL is reported here, with the fix, instead of
 * surfacing as a 500 PrismaClientInitializationError on the first login. Non-fatal on purpose:
 * in development the API stays up while you start the database.
 */
async function checkDatabase() {
  try {
    const users = await basePrisma.user.count();
    console.log(`Database OK (${describeDatabase()}, ${users} user${users === 1 ? '' : 's'})`);
    if (users === 0) console.warn('[db]   Schema reachable but empty — load the demo data with: npm run seed');
  } catch (e) {
    console.error(`[db]   Cannot use the database at ${describeDatabase()}`);
    for (const line of (e as Error).message.trim().split('\n')) console.error(`[db]   ${line}`);
    console.error('[db]   Fix: start the bundled database and keep DATABASE_URL in sync —');
    console.error('[db]        docker compose up -d db        # published on host port 5433');
    console.error('[db]        DATABASE_URL=postgresql://pharma:pharma@localhost:5433/pharmaerp?schema=public');
    console.error('[db]   Or create the role in a PostgreSQL you already run on 5432 —');
    console.error('[db]        psql -U postgres -h localhost -c "CREATE ROLE pharma LOGIN PASSWORD \'pharma\' CREATEDB;"');
    console.error('[db]        psql -U postgres -h localhost -c "CREATE DATABASE pharmaerp OWNER pharma;"');
    console.error('[db]   Then: npx prisma db push --skip-generate && npm run seed');
  }
}

const app = createApp();
const server = app.listen(env.PORT, async () => {
  console.log(`PharmaERP API listening on :${env.PORT}`);
  await checkDatabase();
  startScheduler();
});

const shutdown = async () => { server.close(); await basePrisma.$disconnect(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
