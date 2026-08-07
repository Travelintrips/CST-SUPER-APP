
name: API Server Startup Blocker
description: GCP bootstrap secrets + production DB guard; fix sequence to get API server running

## Rule
API server requires GCP bootstrap secrets in Replit Secrets, then uses them to fetch all other secrets from Google Cloud Secret Manager.

**Bootstrap secrets (Replit Secrets — all three required):**
- `GCP_PROJECT_ID`
- `GCP_SECRET_ID`
- `GCP_SECRET_MANAGER_BOOTSTRAP_JSON`

After loading, GCP injects: `SUPABASE_DATABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, etc.

**Production DB guard:** After GCP secrets load, `startupValidator.ts` detects `NODE_ENV=development` but `SUPABASE_DATABASE_URL` points to production Supabase (pooler.supabase.com). It exits with code 1.

**Why:** Fail-closed to prevent dev writes from hitting production data.

**How to apply:**
- If `SUPABASE_DATABASE_URL_DEV` is NOT in GCP secrets and the project only has one Supabase instance: set `ALLOW_PRODUCTION_DB_IN_DEVELOPMENT=true` as a shared env var (already set Aug 2026).
- `PORTAL_ADMIN_KEY` and `CASHIER_TOKEN_SECRET` are non-fatal warnings — server still starts.
- `pnpm-workspace.yaml` must have `allowBuilds: core-js: true, esbuild: true, protobufjs: true, sharp: true` for pnpm v11+ (fixed Aug 2026).
- The unified development workflow must export `APP_ENV=development` before spawning the secure API process; `NODE_ENV` alone is intentionally rejected.
- The gateway workflow must explicitly run with `APP_ENV=development`; otherwise its spawned secure API process fails closed before binding port 18444.
