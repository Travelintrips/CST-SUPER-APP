---
name: Supabase pooler startup parameters
description: Supabase session pooler may reject statement_timeout as a PostgreSQL startup parameter
---

Supabase pooler connections can fail during startup when the pg client passes `statement_timeout` in connection options; connect first, then set the timeout with a SQL `SET` statement.

**Why:** The pooler rejected the startup parameter before authentication completed, while the same production connection worked when the timeout was set after connect.

**How to apply:** Keep connection options limited to supported startup settings, and configure `statement_timeout`/`lock_timeout` after connection (preferably `SET LOCAL` inside a transaction for destructive work). In one-off `pg` runners, use a validated static SQL literal for `SET`; PostgreSQL does not accept bind placeholders there. Run temporary Node proof scripts from the package workspace (or otherwise provide its module resolution path) so workspace dependencies such as `pg` resolve correctly.