---
name: Boot migration must self-verify, not just swallow DDL errors
description: Pattern for idempotent CREATE TABLE/INDEX IF NOT EXISTS boot migrations that must not silently report success on failure.
---

`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` DDL is already
idempotent — wrapping each statement in `.catch(() => {})` is unnecessary and
dangerous: it also swallows *real* failures (permission errors, connection
drops, syntax errors), so the migration still logs "ready" even when the
table or an index never got created.

**Why:** caught during Phase 3C (order_links cross-reference table) code
review — the original migration used `.catch(() => {})` on every DDL
statement and logged success unconditionally.

**How to apply:** for any new idempotent boot migration, do NOT `.catch()`
away DDL errors — let them throw so the existing `runWithRetry()` wrapper
in `artifacts/api-server/src/index.ts` surfaces and retries the failure.
After the DDL, add an explicit verification step (`to_regclass()` for the
table, `pg_indexes` lookup for expected index names) and only log
"ready"/"verified" once that check passes; throw otherwise.
