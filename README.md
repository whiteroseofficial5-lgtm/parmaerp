# PharmaERP — Pharmaceutical Inventory, Batch Manufacturing & Quality Platform

An enterprise-grade, GMP-oriented ERP for medium-to-large pharmaceutical manufacturers: lot-level raw-material inventory, versioned formulas with an approval workflow, full Batch Manufacturing Records (BMR/BPR) with electronic signatures, QC sample testing and COA issuance, purchasing with AI-assisted invoice matching, AI document extraction for scanned/handwritten BMRs and invoices, QR-code batch traceability, predictive analytics, and an immutable audit trail.

```
pharmaerp/
├── backend/     Node.js + Express + Prisma + PostgreSQL API   (optional — see demo mode)
├── frontend/    Next.js 14 (App Router) + TypeScript + Tailwind + shadcn-style UI
├── docker-compose.yml
└── docs/API.md  Full endpoint reference (auto-generated from the route source)
```

## Hosted demo — no backend, no database

The web app ships in **demo mode** (the default). `frontend/src/app/api/[...path]/route.ts`
answers every `/api/*` call from an in-memory sample dataset (`frontend/src/lib/demo-data.ts`),
so the whole UI — dashboard, inventory, batches, QC, purchasing, expiry, audit, Document AI —
works from a plain `git clone` with nothing else installed.

```bash
cd frontend
npm install
npm run dev            # → http://localhost:3000  (no backend, no Postgres, no Docker)
```

Log in with any demo account (all use password `Pharma@12345`):
`admin@pharma.local` (super admin — sees everything), plus `production@`, `warehouse@`,
`qc@`, `purchase@`, `store@` and `auditor@pharma.local`. The same accounts are listed on the
login screen; click one to fill the form.

**Publish it as a link.** Import this repository on Vercel (or Netlify), set the project's
**Root Directory** to `frontend`, and deploy as-is — no environment variables are required.
The result is a public URL you can send to a client.

What demo mode does *and doesn't* do:
- **Works:** login/RBAC, every list and detail screen, create/approve/release workflows, batch
  lifecycle (approve → start → complete → QC → release), QC results & COA, requisition → PO →
  GRN → QC quarantine, stock receive/issue/transfer/adjust (FEFO), cycle counts, transfers,
  expiry write-off, recalls, notifications, audit trail, forecasts and the QR trace page.
- **Simplified:** signed PDF/XLSX exports and uploaded document previews are placeholders, and
  everything is held in memory — restarting the server (or a new deploy) resets the sample data.
  A banner in the UI says so.

To run against the **real backend**, build the frontend with `DEMO_MODE=false` and
`BACKEND_URL` set to the API — the catch-all route then proxies every request through to
Express/Prisma (or just keep the rewrite by running the Docker stack below).

## Why these design decisions

- **Lot-level inventory, not just quantity counters.** Every receipt creates a `MaterialLot` with its own status (quarantine → approved/rejected → expired/depleted), expiry date and cost. Stock is issued **FEFO** (first-expiry-first-out) using a `SELECT … FOR UPDATE` row lock inside a DB transaction, so concurrent batches can never over-consume a lot. This is the backbone of GMP traceability: `BatchMaterialConsumption` links every gram consumed back to the exact supplier lot.
- **Formulas are versioned, not edited in place.** A formula is `DRAFT → PENDING_APPROVAL → APPROVED`, and approving a new version automatically retires the previous one to `OBSOLETE`. Batches always reference the exact formula version used, so a later formula change never rewrites history.
- **Segregation of duties is enforced in code, not just convention.** The person who authored a formula/batch/purchase order/QC result cannot approve, release or review their own work (`SUPER_ADMIN` is the only break-glass exception) — see `backend/src/services/*.service.ts` for the checks.
- **The audit trail can't be bypassed.** A Prisma client extension (`backend/src/lib/prisma.ts`) wraps every create/update/delete on every model and writes an `AuditLog` row in the *same database transaction*, with before/after JSON, the acting user (via `AsyncLocalStorage`), IP and timestamp. If the audit write fails, the business operation fails too.
- **AI extraction is reviewed, never trusted blindly.** Uploading a scanned BMR or invoice creates an `AiJob`; Claude's vision extraction populates a review screen with the original document side-by-side, per-field confidence flags on anything uncertain, and an automatic validation/matching report. Nothing is written to the ledger until a human clicks "Create batch record" / "Save invoice".
- **The natural-language search never runs SQL.** `backend/src/services/ai/search.ts` gives the model a fixed set of parameterised, RBAC-checked tool functions (search batches, stock status, expiries, invoices…) — the model can only call these, so it can't be prompted into an arbitrary query or a data leak across roles.

## Getting started

### Docker (recommended)
```bash
cp backend/.env.example backend/.env         # edit JWT secrets; add ANTHROPIC_API_KEY for AI document processing
docker compose up --build
```
- Frontend: http://localhost:3000 · API: http://localhost:4000 (proxied through the frontend at `/api`)
- The database seeds automatically on first boot (`SEED_DEMO_DATA=true`) with realistic master data and a full purchase → GRN → QC → batch → release → dispatch history. Demo logins are printed in the `backend` container logs; all use password `Pharma@12345` (e.g. `admin@pharma.local`, `qc@pharma.local`, `production@pharma.local`).

### Manual / local development
The API needs a PostgreSQL database. Pick one of these two, then push the schema and seed once:

```bash
# Option A — bundled container, published on host port 5433 so it can't clash with a native Postgres
docker compose up -d db
#   then set DATABASE_URL in backend/.env to:
#   postgresql://pharma:pharma@localhost:5433/pharmaerp?schema=public

# Option B — use a PostgreSQL already running on localhost:5432 (create the role + db once, as superuser)
psql -U postgres -h localhost -c "CREATE ROLE pharma LOGIN PASSWORD 'pharma' CREATEDB;"
psql -U postgres -h localhost -c "CREATE DATABASE pharmaerp OWNER pharma;"
```

```bash
# Backend
cd backend && cp .env.example .env && npm install
npx prisma db push                      # this repo ships no prisma/migrations folder -> push the schema
npm run seed                            # demo data (runs the real workflows end to end); skips if already seeded
npm run dev                             # http://localhost:4000

# Frontend (separate terminal)
cd frontend && cp .env.example .env && npm install
npm run dev                             # http://localhost:3000
```

Optional production build of the API (the same steps the Docker image runs):
```bash
cd backend && npm run build && npm start   # http://localhost:4000
```
Note `npm run build` emits `dist/src/server.js` (tsc's `rootDir` is the project root because
`prisma/seed.ts` is part of the program), which is why `npm start` and `docker-entrypoint.sh` point there.

If `npm run dev` boots but `POST /api/auth/login` returns a 500 `PrismaClientInitializationError` with
*"the provided database credentials for `pharma` are not valid"*, Prisma reached a server but the role is
missing there (or its password differs) — that is a `DATABASE_URL` problem, not an app bug. (A login
returning 401 `Invalid credentials` instead means the database is fine but `npm run seed` was never run.)

Run `npm run db:doctor` (from `backend/`) to check this in one step — it prints the `host:port/database` and
user actually in effect, queries the `User` table, and maps any Prisma failure to its fix. The API reports
the same verdict at boot, e.g. `Database OK (localhost:5433/pharmaerp, 10 users)`.

### One-command preview (Windows)

If you just want to look at the app, the launcher script does the whole local setup — env files, deps, the
Postgres container from `docker-compose.yml`, `prisma db push` (this repo ships no `prisma/migrations`
folder, so the schema is pushed directly, exactly like `backend/docker-entrypoint.sh`), demo seed data —
and then opens the API and web dev servers plus the browser:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-preview.ps1
# flags: -SkipSeed (keep existing data), -SkipDbSetup (use your own Postgres from backend/.env)
```

Requires Node.js 18+ and Docker Desktop. The bundled `db` service is published on host port **5433** (see
`docker-compose.yml`), and the script rewrites `DATABASE_URL` in `backend/.env` to
`postgresql://pharma:pharma@localhost:5433/pharmaerp?schema=public` so it can't collide with a PostgreSQL
you already run on 5432. Use `-SkipDbSetup` to keep your own database — `backend/.env` is then untouched.

If the API reports `Database connection failed …` or login shows a 503/500 about credentials, run the
repair script. It reuses the running Docker daemon when there is one, otherwise it creates the missing
`pharma` role and `pharmaerp` database on the PostgreSQL already listening on 5432 (it asks for that
server's superuser password), then pushes the schema, seeds the demo data and verifies the result:

```powershell
powershell -ExecutionPolicy Bypass -File .\fix-database.ps1
# flags: -UseDocker | -UseLocalPostgres | -Superuser <name>   (default 'postgres')
```

### Run the demo anywhere (no local PostgreSQL needed)

The PostgreSQL on your machine is irrelevant to the demo — the stack ships and seeds its own database:

```bash
docker compose up --build        # Windows: just double-click start-demo.cmd
```
- Web UI http://localhost:3000 · API http://localhost:4000/api/health
- The database is created and seeded on first boot (through the real workflows, so the audit trail,
  signatures and notifications are populated too). Log in with `admin@pharma.local` / `Pharma@12345`
  — `qc@pharma.local`, `production@pharma.local`, `warehouse@pharma.local`, `purchase@pharma.local`,
  `store@pharma.local` and `auditor@pharma.local` all use the same password.
- `docker compose down` stops it; `docker compose down -v` also wipes the demo data.
- Nothing on your host is disturbed: the `db` container publishes port **5433**, so a PostgreSQL already
  installed on 5432 keeps working exactly as before.

### Putting it on GitHub / showing it to a client

- **Secrets stay out of git.** `.gitignore` excludes `backend/.env` and `frontend/.env`; commit the
  `.env.example` files as shipped (placeholders only).
- **CI proves the demo works.** `.github/workflows/ci.yml` starts a `postgres:16` service container,
  pushes the schema, seeds the demo data, runs the backend typecheck + unit tests, production-builds the
  frontend, then boots the whole Docker stack and logs in through the web UI with the demo account. A
  green run means a fresh `git clone` + `docker compose up --build` also works on your client's machine.
- **Send the client a link (recommended).** Import this repo on Vercel/Netlify with Root Directory
  `frontend` and deploy — demo mode is on by default, so the link needs no backend, no database and no
  environment variables. See *Hosted demo* above.
- **Client options if they want the full stack**
  1. Local: they install Docker Desktop and run `docker compose up --build` (or `start-demo.cmd`).
     The compose build sets `DEMO_MODE=false`, so this path exercises the real API.
  2. **GitHub Codespaces** — this repo ships `.devcontainer/devcontainer.json` (Node 20 + Docker-in-Docker,
     ports 3000/4000 forwarded, dependencies pre-installed). *Code → Codespaces → Create*, run
     `docker compose up -d --build`, open the forwarded port 3000 and make it public to send a link.
  3. Hosted: point `DATABASE_URL` at a managed Postgres free tier (Neon / Supabase / Railway), run
     `npx prisma db push` + `npm run seed` once, host the API container anywhere and deploy the frontend
     to Vercel/Netlify with `DEMO_MODE=false` and `BACKEND_URL` set to that API.

### Tests
```bash
cd backend && npm test     # unit tests: UOM conversion, fuzzy matching, expiry dates, forecasting, RBAC/segregation-of-duties
```

## Core modules → where to look

| Module | Backend | Frontend |
|---|---|---|
| Dashboard & KPIs | `services/dashboard.service.ts` | `app/(app)/dashboard` |
| Raw material master & stock | `services/inventory.service.ts`, `routes/masters.ts`, `routes/inventory.ts` | `app/(app)/raw-materials`, `app/(app)/inventory` |
| Formula / BOM + approval | `services/formula.service.ts` | `app/(app)/formulas` |
| Batch manufacturing (BMR) | `services/batch.service.ts` | `app/(app)/batches` |
| Production planning & work orders | `routes/manufacturing.ts` (production section) | `app/(app)/production` |
| Finished goods & dispatch | `routes/inventory.ts` (fgRouter) | `app/(app)/finished-goods` |
| Expiry, write-off & recalls | `services/expiry.service.ts` | `app/(app)/expiry` |
| Suppliers & purchasing (PO/GRN) | `services/purchase.service.ts` | `app/(app)/suppliers`, `app/(app)/purchase` |
| Quality control & COA | `services/qc.service.ts` | `app/(app)/qc` |
| Warehouses / racks / bins | `routes/masters.ts` | `app/(app)/warehouses` |
| Reporting (Excel/CSV/PDF) | `services/report.service.ts` | `app/(app)/reports` |
| Users, roles, RBAC matrix | `config/permissions.ts`, `routes/auth.ts` | `app/(app)/users` |
| Audit trail | `lib/prisma.ts` (extension), `routes/platform.ts` | `app/(app)/audit` |
| Notifications & alert sweep | `services/expiry.service.ts` (`runSweep`), `jobs/scheduler.ts` | `app/(app)/notifications` |
| **AI document processing** (BMR/invoice OCR+extraction) | `services/ai/provider.ts`, `services/ai/jobs.service.ts` | `app/(app)/ai/documents` |
| **AI invoice matching & fraud flags** | `services/purchase.service.ts` (`matchInvoice`) | `app/(app)/purchase` (invoice review) |
| **AI batch record validation** | `services/ai/validation.ts` | batch detail → "Validation" tab |
| **Natural-language search** | `services/ai/search.ts` | `app/(app)/ai/search` |
| **Predictive analytics** (forecast, reorder, expiry risk, supplier scoring) | `services/ai/forecast.ts` | `app/(app)/analytics` |
| QR traceability | `lib/qr.ts`, `services/batch.service.ts` (`traceBatch`) | public page `app/trace/[batchNumber]` |
| Document management | `routes/platform.ts` (documentsRouter) | `app/(app)/documents` |

Full endpoint list: **[`docs/API.md`](docs/API.md)** (auto-generated from the route source, 179 endpoints).

## Configuring the AI features
Set `ANTHROPIC_API_KEY` in `backend/.env` to enable:
- Vision-based extraction of typed, scanned and **handwritten** BMRs and invoices (Claude reads the PDF/image directly — no separate OCR step).
- The natural-language "Ask the system" search.
- Narrative summaries on validation reports.

Without a key, the system falls back to local OCR (`tesseract.js` + `poppler-utils` for scanned PDFs) for header-field extraction only, and a keyword-rule engine for search — the UI shows which engine is active.

## Notes on the demo data
`prisma/seed.ts` doesn't insert rows directly into tables; it *calls the real service functions* (create formula → submit → approve; create PO → approve → receive; create batch → approve → start → complete → QC → release → dispatch). This means the audit trail, electronic signatures, stock ledger and notifications are exactly as they'd be in production — useful both as a demo and as a regression check that the workflows actually work end to end.
