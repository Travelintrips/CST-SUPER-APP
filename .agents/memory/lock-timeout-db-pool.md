---
name: DB Pool lock_timeout fix
description: Startup DDL migrations hung indefinitely when a killed API instance left open Supabase locks; fix is lock_timeout in on('connect') handler.
---

## Rule
Set `lock_timeout` on every new database connection via the pool's `on('connect')` handler, not just via pool `options` (which is unreliable with PgBouncer transaction mode).

## What broke
After repeated kill-and-restart cycles of the API server, ALTER TABLE statements in the startup migration chain would wait indefinitely for DDL locks held by orphaned connections from the previously-killed instances. The process appeared "alive" but the log froze at whatever migration step tried to acquire the lock.

## Fix applied (lib/db/src/index.ts)
```ts
pool.on("connect", (client) => {
  // Set search_path — PgBouncer transaction mode does not preserve it
  // Set lock_timeout — prevents startup DDL from hanging on stale locks
  client.query("SET search_path = public; SET lock_timeout = '20s'").catch(() => {});
});
```
Also added `-c lock_timeout=15000` to pool `options` as belt-and-suspenders, but the `on('connect')` handler is the reliable path with PgBouncer.

**Why:** PgBouncer in transaction mode uses cached backend connections; startup parameters via `options` may not be re-applied on reuse. The `on('connect')` handler runs for every new server connection and is authoritative.

**How to apply:** Any time `lib/db/src/index.ts` pool config is modified, keep both the `options` string AND the `on('connect')` handler in sync. The migration chain's non-fatal try/catch blocks will log a WARN and continue when a lock times out — the idempotent DDL will succeed on next startup.

## Rebuild required after change
```
cd artifacts/api-server && node build.mjs
```
Then restart the "Start application" workflow.
