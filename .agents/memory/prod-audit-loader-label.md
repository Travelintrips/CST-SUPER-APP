---
name: Production audit loader label
description: Production Secret Manager bundle can load while the DB pool log still labels NODE_ENV as development.
---

For production-only Supabase audits, prove the target by loading the `cst-super-app-production` Secret Manager bundle and using its canonical `SUPABASE_DATABASE_URL`; do not rely on the pool log's `env` label alone when `NODE_ENV` is unset.

**Why:** The production loader correctly selected the production bundle, but the shared DB module reported `env=development` because the one-off process did not set `NODE_ENV`; the canonical production URL still selected the production database.

**How to apply:** Keep audits read-only, record the bundle/environment proof, and avoid injecting development keys or using `SUPABASE_DATABASE_URL_DEV` during production checks.