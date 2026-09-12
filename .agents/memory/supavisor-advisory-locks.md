---
name: Supavisor advisory locks
description: Development startup migration locks can remain held by an idle Supavisor backend after a client process is killed.
---

Session-level PostgreSQL advisory locks are unsafe to assume released when an application client is returned through a Supavisor transaction pooler. A killed or failed startup process can leave an idle pooled backend holding the stage lock, causing later processes to time out.

**Why:** A development restart repeatedly timed out on one startup stage while PostgreSQL showed an idle Supavisor backend holding the exact advisory lock; terminating that identified DEV backend allowed the next startup to complete.

**How to apply:** Inspect `pg_locks` and `pg_stat_activity` first, match the exact hashed stage key, and only terminate the identified stale DEV backend. Never use this recovery on production without an explicit incident procedure.