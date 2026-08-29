---
name: Development TypeScript proof tooling
description: How to run temporary database-backed TypeScript proofs in this monorepo when the workflow image lacks tsx.
---

Use esbuild to bundle a temporary proof script, write the bundle under an artifact directory so Node resolves the workspace's node_modules, run it through the official DEVELOPMENT Secret Manager loader, then remove the temporary bundle.

**Why:** The artifact environment may not expose `tsx`, and a bundle emitted under `/tmp` cannot resolve external packages such as `pg` from the workspace dependency tree.

**How to apply:** Keep proof source and generated output temporary, use `APP_ENV=development node load-secrets.mjs ...`, never print secret values, and do not use this pattern for production access.