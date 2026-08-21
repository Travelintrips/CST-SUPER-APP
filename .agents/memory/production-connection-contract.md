---
name: Production connection contract
description: The app's production business database is external Supabase loaded from the production GCP bundle.
---

The canonical production database connection is `SUPABASE_DATABASE_URL` loaded by `load-secrets.mjs` from the `cst-super-app-production` Secret Manager bundle; the Replit database-pane production abstraction may be unavailable independently.

**Why:** A missing Replit production database does not necessarily mean the deployed application's external Supabase production database is inaccessible.

**How to apply:** For production read-only audits, use the existing production loader and a dedicated read-only PostgreSQL client, then compare metadata against the DEV bundle. Never substitute DEV or create a new secret contract.