---
name: Development migration URL safety
description: Environment-specific Supabase bundles can expose a migration URL that points at production.
---

Never use `SUPABASE_MIGRATION_URL` from the development bundle without independently verifying its project reference. In this environment, the DEV database URL points to the DEV project while the DEV migration URL points to PROD; use the verified DEV URL for read-only DEV proof and reserve the production migration URL for explicitly approved PROD DDL.

**Why:** A migration connection string is a write-capable target, and trusting the bundle key name alone can send a development operation to production.

**How to apply:** Verify both project reference and port before any DDL. Treat a DEV migration URL pointing to the production project as an operational configuration defect, not as a reason to bypass the target guard.