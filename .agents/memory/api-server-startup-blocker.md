
name: API Server Startup Blocker
description: GCP bootstrap secrets + production DB guard; fix sequence to get API server running

## Rule
API server requires the GCP bootstrap service-account JSON in Replit Secrets, then uses it to fetch the environment bundle from Google Cloud Secret Manager. In the current single-credential mode, the project and bundle identifiers are resolved from that JSON/environment contract; `GCP_PROJECT_ID` and `GCP_SECRET_ID` are only required for legacy mode.

**Current bootstrap secret (Replit Secrets):**
- `GCP_SECRET_MANAGER_BOOTSTRAP_JSON`

**Legacy mode only:**
- `GCP_PROJECT_ID`
- `GCP_SECRET_ID`

After loading, GCP injects: `SUPABASE_DATABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, etc.

**Production DB guard:** After GCP secrets load, `startupValidator.ts` detects `NODE_ENV=development` but `SUPABASE_DATABASE_URL` points to production Supabase (pooler.supabase.com). It exits with code 1.

**Why:** Fail-closed startup prevents missing credentials and accidental dev writes from reaching production data. A missing bootstrap JSON makes the API child exit before binding its port, leaving the BizPortal proxy unable to serve API-backed screens.

**How to apply:**
- If `SUPABASE_DATABASE_URL_DEV` is NOT in GCP secrets and the project only has one Supabase instance: set `ALLOW_PRODUCTION_DB_IN_DEVELOPMENT=true` as a shared env var (already set Aug 2026).
- `PORTAL_ADMIN_KEY` and `CASHIER_TOKEN_SECRET` are non-fatal warnings — server still starts.
- `pnpm-workspace.yaml` must have `allowBuilds: core-js: true, esbuild: true, protobufjs: true, sharp: true` for pnpm v11+ (fixed Aug 2026).
- The unified development workflow must export `APP_ENV=development` before spawning the secure API process; `NODE_ENV` alone is intentionally rejected.
- The gateway workflow must explicitly run with `APP_ENV=development`; otherwise its spawned secure API process fails closed before binding port 18444.
- A clean `pnpm install --frozen-lockfile` may be needed when runtime packages (for example Secret Manager) are missing from `node_modules`; it restores the lockfile without changing manifests. After that, the API still needs the bootstrap secret to start.
- A BizPortal proxy can bind its public port while the secure API child repeatedly exits for missing bootstrap secrets; treat preview/API readiness as failed until the API port is actually serving.
