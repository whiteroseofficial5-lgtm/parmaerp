/* Diagnoses the DATABASE_URL from backend/.env without needing the API or the web app.
   It prints where the URL points, then runs the same query the login route runs.
   Usage (from backend/):  npm run db:doctor */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

function describe(raw: string) {
  try {
    const u = new URL(raw);
    return `${u.hostname}:${u.port || '5432'}${u.pathname} as user "${u.username}"`;
  } catch {
    return '(DATABASE_URL is missing or not a valid postgresql:// URL)';
  }
}

async function main() {
  const raw = process.env.DATABASE_URL ?? '';
  console.log(`DATABASE_URL -> ${describe(raw)}`);

  try {
    const users = await db.user.count();
    console.log(`OK   Connected. Table "User" has ${users} row(s).`);
    if (users === 0) console.log('     Schema is pushed but empty -> run: npm run seed');
    else console.log('     Ready: sign in at http://localhost:3000 with admin@pharma.local / Pharma@12345');
  } catch (e) {
    const err = e as Error & { code?: string };
    console.log(`FAIL ${err.name}${err.code ? ` (${err.code})` : ''}`);
    console.log(String(err.message).split('\n').map((l) => `     ${l}`).join('\n'));
    console.log('');
    console.log('How to read this:');
    console.log('  cannot reach / ECONNREFUSED  -> nothing is listening on that host:port');
    console.log('      start the bundled database:  docker compose up -d db      (host port 5433)');
    console.log('  authentication failed        -> the role/password in DATABASE_URL is wrong for that server');
    console.log('      keep DATABASE_URL in sync with the server you actually run, or create the role once:');
    console.log('          psql -U postgres -h localhost -c "CREATE ROLE pharma LOGIN PASSWORD <pw> CREATEDB;"');
    console.log('          psql -U postgres -h localhost -c "CREATE DATABASE pharmaerp OWNER pharma;"');
    console.log('  does not exist (P1003)       -> the database itself is missing: create it, then push the schema');
    console.log('  table does not exist (P2021) -> schema never pushed: npx prisma db push --skip-generate');
    console.log('      then load the demo data:   npm run seed');
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
