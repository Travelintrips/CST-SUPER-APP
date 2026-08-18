---
name: Development migration URL safety
description: Environment-specific Supabase bundles can expose a migration URL that points at production.
---

Never use `SUPABASE_MIGRATION_URL` from the development bundle without independently verifying its project reference. The development bundle had a PROD migration URL while its DEV database URL was correct; it is now corrected to a DEV 5432 target and guarded by the verifier.

**Why:** A migration connection string is a write-capable target, and trusting the bundle key name alone can send a development operation to production.

**How to apply:** Verify both project reference and port before any DDL. Treat a DEV migration URL pointing to the production project as an operational configuration defect, not as a reason to bypass the target guard.

The runtime DB guard and migration-target guard are separate controls: the former
protects the application's connection URL, while the latter protects the
write-capable `SUPABASE_MIGRATION_URL`.

**Why:** An application can connect safely at runtime while a separately
configured migration URL still points to the wrong project or port.

**How to apply:** Require both checks to pass before migration; never infer
migration-target safety from runtime DB guard success alone.

The PROD bundle's direct/session migration target is now configured and
verified against the PROD project reference on port 5432. Keep the runtime
pooler URL and the write-capable migration URL as separate independently
verified targets.