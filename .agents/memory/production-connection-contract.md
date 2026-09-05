---
name: Production connection contract
description: The app's production business database is external Supabase loaded from the production GCP bundle.
---

The canonical production database connection is `SUPABASE_DATABASE_URL` loaded by `load-secrets.mjs` from the `cst-super-app-production` Secret Manager bundle; the Replit database-pane production abstraction may be unavailable independently.

**Why:** A missing Replit production database does not necessarily mean the deployed application's external Supabase production database is inaccessible.

**How to apply:** For production audits and mutations, use the existing production loader and the canonical `SUPABASE_DATABASE_URL` explicitly. A helper that prioritizes `SUPABASE_MIGRATION_URL` can select a different port/connection path; never substitute DEV or create a new secret contract.