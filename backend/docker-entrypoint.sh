#!/bin/sh
set -e
# Apply migrations if the project has them; otherwise create the schema directly (first run / demo).
if [ -d prisma/migrations ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  npx prisma migrate deploy
else
  npx prisma db push --skip-generate
fi
# Demo data. Run the COMPILED seeder: prisma/seed.ts imports src/**/*.ts, and this image ships only
# dist/ + prisma/. tsc's rootDir is the project root (prisma/seed.ts is part of the program), so the
# emitted layout is dist/src/** for the API and dist/prisma/seed.js for the seeder. Failing loudly on
# purpose: this used to be silenced, which left the demo running with an empty database and no logins.
if [ "$SEED_DEMO_DATA" = "true" ]; then
  node dist/prisma/seed.js
fi
exec node dist/src/server.js
