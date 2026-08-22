---
name: Production audit loader label
description: Production Secret Manager bundle can load while the DB pool log still labels NODE_ENV as development.
---

For production-only Supabase audits, prove the target by loading the `cst-super-app-production` Secret Manager bundle, set both `APP_ENV=production` and `NODE_ENV=production` for standalone runners, and use the canonical `SUPABASE_DATABASE_URL`; do not rely on the pool log's `env` label alone.

**Why:** The production loader correctly selected the production bundle, but the shared DB module reported `env=development` and selected the DEV URL when the one-off process omitted `NODE_ENV`. Setting it explicitly selected the production pooler, which then exposed a real `28P01` credential failure. `SUPABASE_MIGRATION_URL` is a separate migration-tooling key and is not automatically selected by the shared runtime DB module.

**How to apply:** Keep audits read-only, record the bundle/environment proof, never inject development keys during production checks, and treat a production `28P01` as a credential/target repair blocker rather than retrying repeatedly.