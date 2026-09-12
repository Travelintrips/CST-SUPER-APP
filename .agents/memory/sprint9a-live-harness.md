---
name: Sprint 09A live harness
description: Constraints for running the Sprint 09A handoff proof against the development runtime.
---

Use a temporary ESM harness that externalizes `pg`, `pino`, and `pino-pretty`; bundling the logger into a standalone ESM file triggers unsupported dynamic `require` calls.

**Why:** The real handoff service imports the application logger and workspace database package, while the temporary harness runs from `/tmp` and does not inherit the artifact's package resolution.

**How to apply:** Set `APP_ENV=development`, use `SUPABASE_DATABASE_URL_DEV` explicitly, resolve external packages from the API artifact's workspace links, and use the runtime `vi_status` value `ready_for_ap` for invoice fixtures. Keep fixtures and rollback triggers outside the repository and clean them in `finally`.