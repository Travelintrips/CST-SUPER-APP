---
name: Production startup lock deadlock
description: Blue/green production startup can be blocked by an older backend holding a migration-stage advisory lock.
---

When a newly published instance reports `ready=false` with a startup migration lock timeout, inspect `pg_locks` and `pg_stat_activity` read-only before changing code or markers. An older idle backend may still hold the stage’s session advisory lock while the new instance waits.

**Why:** Production startup uses per-stage advisory locks and blue/green deployment can leave the previous backend alive long enough to block the replacement. Treating the timeout as a missing migration and manually advancing registry state can conceal an unsafe deployment.

**How to apply:** Require `/api/health/ready` to be fully healthy before shadow activation. If an older holder is identified, use the official deployment restart/drain path; do not call `pg_terminate_backend`, edit completion markers, or activate shadow while readiness is false.