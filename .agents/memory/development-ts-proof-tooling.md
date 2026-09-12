---
name: Development TypeScript proof tooling
description: How to run temporary database-backed TypeScript proofs in this monorepo when the workflow image lacks tsx.
---

Use esbuild to bundle a temporary proof script, write the bundle under an artifact directory so Node resolves the workspace's node_modules, run it through the official environment-specific Secret Manager loader, then remove the temporary bundle.

**Why:** The artifact environment may not expose `tsx`, and a bundle emitted under `/tmp` cannot resolve external packages such as `pg` from the workspace dependency tree. `APP_ENV` selects the Secret Manager bundle, while the DB package uses `NODE_ENV=production` or `REPLIT_DEPLOYMENT` to select PROD routing.

**How to apply:** Keep proof source and generated output temporary, use `APP_ENV=development NODE_ENV=development` for DEV or `APP_ENV=production NODE_ENV=production` for PROD, never print secret values, and verify the DB log says the intended environment before trusting results.