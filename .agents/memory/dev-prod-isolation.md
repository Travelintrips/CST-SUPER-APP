---
name: Dev/Prod DB Isolation
description: How dev workspace is isolated from production database via APP_ENV and load-secrets.mjs
---

## Rule
Dev workspace uses `APP_ENV=development` (default in `start-dev.sh`).
Production deployment has `REPLIT_DEPLOYMENT=1` set automatically.

**Why:** Previously `APP_ENV` defaulted to `production`, causing `NODE_ENV=production` in `dev.mjs`, which made `lib/db` use `SUPABASE_DATABASE_URL` (prod DB). All dev transactions were hitting production data.

**How to apply:**
- `start-dev.sh`: `APP_ENV=${APP_ENV:-development}` — do NOT change back to `production`
- `load-secrets.mjs` dev mode: injects `*_DEV` GCP keys as canonical names, PLUS non-`_DEV` keys that have no `_DEV` counterpart (shared API keys)
- `lib/db/src/index.ts`: in dev mode (`NODE_ENV=development`), tries `SUPABASE_DATABASE_URL_DEV` first, then `SUPABASE_DATABASE_URL`
- GCP Secret Manager stores `SUPABASE_DATABASE_URL_DEV` (dev DB URL) alongside `SUPABASE_DATABASE_URL` (prod)

## Isolation contract
- Keys WITH `_DEV` variant in GCP → strict isolation (only `_DEV` version used in dev)
- Keys WITHOUT `_DEV` variant → shared between dev and prod (e.g., OPENAI_API_KEY, GOOGLE_SERVICE_ACCOUNT_JSON)
- `SUPABASE_DATABASE_URL` always points to the environment-appropriate DB after secrets are injected

## Required _DEV keys in GCP Secret Manager for full isolation
If any of these are missing, dev falls back to the prod value (shared DB):
1. `SUPABASE_DATABASE_URL_DEV` — PostgreSQL connection string (pooler port 6543)
2. `SUPABASE_URL_DEV` — Supabase project API URL (https://xxx.supabase.co)
3. `SUPABASE_ANON_KEY_DEV` — anon/public JWT key
4. `SUPABASE_SERVICE_ROLE_KEY_DEV` — service role JWT key
5. `VITE_SUPABASE_URL_DEV` — same as SUPABASE_URL_DEV (for frontend bundle)
6. `VITE_SUPABASE_ANON_KEY_DEV` — same as SUPABASE_ANON_KEY_DEV (for frontend bundle)
7. `SUPABASE_STORAGE_BUCKET_DEV` — optional; skip = storage not isolated

## Setup tool
`scripts/setup-dev-supabase.mjs` — interactive script to add _DEV keys to GCP Secret Manager.
Run via: `cd artifacts/api-server && node load-secrets.mjs node ../../scripts/setup-dev-supabase.mjs`
After adding keys: restart Gateway, then run `node scripts/run-dev-migrations.mjs` to apply schema to dev DB.

## Root cause of "prod data in dev" (resolved Aug 2026)
GCP Secret Manager correctly had separate _DEV keys all along. The real bug:
- Replit workspace has `APP_ENV=production` set as a persistent environment variable
- `start-dev.sh` used `APP_ENV=${APP_ENV:-development}` — bash `:-` does NOT override an already-set variable
- Result: API server started with `APP_ENV=production` → lib/db used `SUPABASE_DATABASE_URL` (prod) ignoring `SUPABASE_DATABASE_URL_DEV`
- Fix: change to unconditional `APP_ENV=development` in `artifacts/api-server/start-dev.sh`
- `start-dev.sh` is never called during real deployment (production uses Gateway with REPLIT_DEPLOYMENT=1), so the override is safe

**Rule: any `start-dev.sh` file must use unconditional `APP_ENV=development`, not `${APP_ENV:-development}`.**

## Preview frontend rule
Preview frontend services must run Vite with `APP_ENV=development` and load secrets through `load-secrets.mjs`. A pre-built `vite preview` bundle can retain a production Supabase URL from build time even when the API is correctly using the development database.

**Why:** The unified Gateway previously served pre-built frontend assets while its API had been corrected to development, leaving direct Supabase clients in the browser connected to the production project.

**How to apply:** Use Vite development servers for the Replit preview; reserve pre-built `vite preview` assets for actual production deployments where `REPLIT_DEPLOYMENT` is set.
