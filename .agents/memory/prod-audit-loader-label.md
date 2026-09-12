---
name: Production audit loader label
description: Production Secret Manager bundle can load while the DB pool log still labels NODE_ENV as development.
---

For production-only Supabase audits, load the `cst-super-app-production` Secret Manager bundle, set both `APP_ENV=production` and `NODE_ENV=production`, unset inherited `*_DEV` database variables, and use canonical `SUPABASE_DATABASE_URL`.

**Why:** The production loader adds production keys but does not remove workspace-inherited development keys. A standalone shared DB module can therefore select DEV unless its environment is explicitly production and DEV connection variables are absent. `SUPABASE_MIGRATION_URL` is a separate migration-tooling key and is not the runtime DB URL.

**How to apply:** Keep audits read-only and record the bundle/environment proof. For shared-runtime proof harnesses, launch with production mode and unset `SUPABASE_DATABASE_URL_DEV` (plus related DEV URL keys) before invoking the loader; direct `pg` checks should bind only canonical `SUPABASE_DATABASE_URL`.