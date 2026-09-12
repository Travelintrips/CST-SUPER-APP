# Staging Environment — Setup & Operations Guide

**Last Updated:** 2026-07-24  
**Status:** ⛔ NOT CONFIGURED — Full HTTP E2E remains BLOCKED until this is provisioned  
**Owner:** Platform / DevOps lead

---

## Phase 1 — Staging Environment Discovery Report

| Resource | Variable | Status |
|---|---|---|
| Test / staging database | `TEST_DATABASE_URL` | ❌ NOT CONFIGURED |
| Staging database (alt) | `STAGING_DATABASE_URL` | ❌ NOT CONFIGURED |
| Test Supabase URL | `TEST_SUPABASE_URL` | ❌ NOT CONFIGURED |
| Test Supabase anon key | `TEST_SUPABASE_ANON_KEY` | ❌ NOT CONFIGURED |
| Test Supabase service role | `TEST_SUPABASE_SERVICE_ROLE_KEY` | ❌ NOT CONFIGURED |
| Test storage bucket | `TEST_STORAGE_BUCKET` | ❌ NOT CONFIGURED |
| Payment sandbox | `PAYLABS_PRIVATE_KEY_SANDBOX` | ✅ Configured in dev env |
| WA sandbox | — | ⚠️ Uses live Fonnte/WATI tokens (no sandbox mode) |
| Email sandbox | `SMTP_HOST` / `SMTP_USER` | ⚠️ Not confirmed as sandbox |

**Note on DEV environment:** `SUPABASE_URL_DEV` and `SUPABASE_DATABASE_URL_DEV` point to a separate Supabase project
(`xssrfshdrtdfupgqwfdw`) used for day-to-day development. This is **NOT** a staging target — it contains
shared development data and is missing several production-level tables. Full HTTP E2E **must not** run against it.

---

## Overview

A dedicated **staging environment** is a fully isolated replica of the production stack, used exclusively to run
the Full HTTP E2E harness (`scripts/customer-full-http-e2e.mjs`) before each production release.

It must be:
- Separate from the shared development database (`SUPABASE_URL_DEV`)
- Separate from the production database (`SUPABASE_URL`)
- Populated with a known-good seed dataset
- Destroyed or cleaned after each E2E run

---

## 1. Environment Variables Required

All variables must be injected into the Replit **staging/test** secret store — never hardcoded.

### 1.1 Database

| Variable | Description | Provider | Sandbox? |
|---|---|---|---|
| `TEST_DATABASE_URL` | PostgreSQL connection string for the test/staging Supabase project | Supabase | Yes — isolated project |
| `STAGING_DATABASE_URL` | Alternative name accepted by the E2E harness | Supabase | Yes — isolated project |
| `TEST_SUPABASE_URL` | Supabase REST/Auth URL for the staging project | Supabase | Yes |
| `TEST_SUPABASE_ANON_KEY` | Anon JWT for the staging project | Supabase | Yes |
| `TEST_SUPABASE_SERVICE_ROLE_KEY` | Service-role JWT for the staging project | Supabase | Yes |
| `TEST_STORAGE_BUCKET` | S3-compatible storage endpoint for the staging project | Supabase Storage | Yes |

### 1.2 Auth / Session

| Variable | Description | Notes |
|---|---|---|
| `SESSION_SECRET` | Express session signing key | Use a dedicated staging value |
| `PORTAL_JWT_SECRET` | Customer/vendor JWT signing | Use a dedicated staging value |
| `DRIVER_JWT_SECRET` | Driver app JWT signing | Use a dedicated staging value |
| `CASHIER_TOKEN_SECRET` | POS cashier token signing | Use a dedicated staging value |
| `PORTAL_ADMIN_KEY` | Admin API key | Use a dedicated staging value |

### 1.3 External Integrations

| Variable | Description | Provider | Sandbox? |
|---|---|---|---|
| `FONNTE_TOKEN` | WhatsApp via Fonnte | Fonnte | Fonnte does not offer a sandbox; use a test-only registered device or suppress via `E2E_TEST_MODE=true` |
| `WATI_API_TOKEN` | WhatsApp via WATI | WATI | Use WATI sandbox number if available |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | Outbound email | SMTP provider | Use Mailtrap or similar SMTP sandbox |
| `PAYLABS_PRIVATE_KEY_SANDBOX` | Payment processing | Paylabs | ✅ Sandbox key — already supported |
| `OPENAI_API_KEY` | AI features | OpenAI | Use a quota-limited staging key |
| `GOOGLE_CLIENT_SECRET` | OAuth login | Google Cloud | Use a staging OAuth client with restricted redirect URIs |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Sheets sync | Google Cloud | Restrict to staging spreadsheet only |

### 1.4 Flags

| Variable | Value | Description |
|---|---|---|
| `E2E_TEST_MODE` | `true` | Enables `/api/e2e-safety` endpoint; restricts writes to synthetic run ID records; suppresses external notifications (WA, email, push) |
| `RUNTIME_TEST_RUN_ID` | `staging-YYYYMMDD-HHMMSS` | Unique run identifier — all synthetic records tagged with this value for targeted cleanup |
| `NODE_ENV` | `test` | Controls DB pool sizing, boot migration verbosity, and log format |

---

## 2. Supabase Staging Project Setup

### 2.1 Create the staging project

1. Log in to [app.supabase.com](https://app.supabase.com).
2. Click **New Project** → name it `cst-super-app-staging`.
3. Choose the same region as production (`ap-southeast-2`).
4. Set a strong database password (store it securely — not in this file).
5. After creation, copy:
   - Project URL → `TEST_SUPABASE_URL`
   - `anon` key → `TEST_SUPABASE_ANON_KEY`
   - `service_role` key → `TEST_SUPABASE_SERVICE_ROLE_KEY`
   - Pooler connection string (Transaction mode, port 6543) → `TEST_DATABASE_URL`
   - Direct connection string (port 5432) → `SUPABASE_MIGRATION_URL` (staging variant)
   - Storage URL → `TEST_STORAGE_BUCKET`

### 2.2 Apply migrations

Run migrations against the staging project using the **direct connection** (not pooler):

```bash
SUPABASE_MIGRATION_URL=<staging-direct-url> pnpm run db:migrate:test
```

The migration script applies all pending SQL in order, idempotently.

### 2.3 Create the storage bucket

In Supabase dashboard → Storage → New Bucket:
- Name: `attachments-staging`
- Public: No
- File size limit: same as production

### 2.4 Verify connectivity

```bash
TEST_DATABASE_URL=<staging-url> node -e "
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const r = await pool.query('SELECT current_database(), now()');
  console.log('Connected:', r.rows[0]);
  await pool.end();
"
```

Expected output: prints database name and current timestamp without error.

---

## 3. Inject Secrets into Replit

Replit has **two secret stores** that must be set independently:

| Store | Purpose | How to access |
|---|---|---|
| Workspace (development) | Local dev server, Gateway | Replit UI → Secrets tab |
| Deployment (production) | Deployed app | Replit UI → Deploy → Secrets |

For staging, add a third config block or use environment-specific Replit secrets.

```bash
# Use Replit Secrets panel to set each key listed in Section 1.
# Never paste raw secret values into code files or this document.
```

---

## 4. Run Migrations Against Staging

```bash
# Set staging migration URL as env var then run
SUPABASE_MIGRATION_URL="<staging-direct-url>" pnpm run db:migrate:test
```

The migrate script is idempotent — safe to re-run. Verify with:

```bash
TEST_DATABASE_URL=<staging-url> node -e "
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const r = await pool.query(\"SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1\");
  console.log('Tables:', r.rows.length);
  await pool.end();
"
```

---

## 5. Seed Data for E2E

The E2E harness (`scripts/customer-full-http-e2e.mjs`) creates all its own synthetic data at runtime using
`RUNTIME_TEST_RUN_ID` as a namespace. No manual seed is required.

However, the following must exist before the harness runs:
- At least one `companies` row with `id = 1` (root company / holding)
- At least one `users` row for admin login (created via harness seeding or pre-seed script)
- COA (chart of accounts) base rows for the holding company

A pre-seed script will be added at `scripts/seed-staging.mjs` — currently **TODO**.

---

## 6. Run Full HTTP E2E Against Staging

```bash
# Start the API server pointed at staging DB
TEST_DATABASE_URL=<staging-url> \
TEST_SUPABASE_URL=<staging-url> \
TEST_SUPABASE_SERVICE_ROLE_KEY=<staging-key> \
E2E_TEST_MODE=true \
RUNTIME_TEST_RUN_ID="rc-$(date +%Y%m%d-%H%M%S)" \
PORT=18444 \
pnpm --filter @workspace/api-server run dev &

# Wait for server to start
sleep 10

# Run the harness
TEST_DATABASE_URL=<staging-url> \
RUNTIME_TEST_RUN_ID="rc-$(date +%Y%m%d-%H%M%S)" \
pnpm run audit:customer-http-e2e
```

Or simply run the full production gate which orchestrates all sub-gates:

```bash
TEST_DATABASE_URL=<staging-url> \
E2E_TEST_MODE=true \
pnpm run audit:customer-production
```

---

## 7. Cleanup After E2E

The E2E harness automatically deletes all rows tagged with `RUNTIME_TEST_RUN_ID` at the end of each run.

To manually clean:

```bash
# Only deletes rows with the run ID prefix — never touches unrelated data
TEST_DATABASE_URL=<staging-url> \
RUNTIME_TEST_RUN_ID="<run-id>" \
node scripts/customer-full-http-e2e.mjs --cleanup-only
```

---

## 8. Rollback

To destroy the staging environment:

1. **Supabase:** app.supabase.com → Project → Settings → Danger Zone → Delete Project.
2. **Storage:** All files are automatically deleted with the project.
3. **Replit Secrets:** Remove all `TEST_*` and `STAGING_*` keys from the Secrets panel.
4. **Migrations:** No rollback needed — staging is ephemeral.

To rollback to previous staging snapshot (if you used Supabase branching):
- Supabase Dashboard → Branches → restore previous branch.

---

## 9. Verify Staging is Ready

Before running the production gate, confirm staging readiness:

```bash
# 1. DB connectivity
psql "$TEST_DATABASE_URL" -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'"

# 2. API server reachable in E2E mode
curl -sf http://127.0.0.1:18444/api/e2e-safety | jq .

# 3. Storage bucket accessible
curl -I "$TEST_STORAGE_BUCKET"
```

All three must succeed before running `pnpm run audit:customer-production`.

---

## 10. Current Blockers (as of 2026-07-24)

| Blocker | Resolution |
|---|---|
| `TEST_DATABASE_URL` not configured | Create Supabase staging project → inject secret |
| Staging migrations not applied | Run `db:migrate:test` after project creation |
| Staging seed not available | Create `scripts/seed-staging.mjs` |
| WA/email sandbox not confirmed | Configure Mailtrap for SMTP; use WATI sandbox number |
| Full HTTP E2E: BLOCKED | Unblocked automatically once `TEST_DATABASE_URL` is injected and server is running |
