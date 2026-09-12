---
name: DB URL priority in dev mode
description: resolveConnectionString() in lib/db/src/index.ts candidate order for dev — updated to prefer SUPABASE_DATABASE_URL over DATABASE_URL since user explicitly uses Supabase dev DB.
---

## The Rule (Updated)
In `lib/db/src/index.ts` dev candidate order is:
1. `SUPABASE_DATABASE_URL_DEV`
2. `SUPABASE_DATABASE_URL`   ← Supabase dev project: xssrfshdrtdfupgqwfdw
3. `DATABASE_URL`             ← Replit native PG (helium) — fallback only

**Why changed:** User explicitly wants to use Supabase dev DB (xssrfshdrtdfupgqwfdw) and has added credentials to Replit secrets. The original DATABASE_URL-first ordering was causing "relation does not exist" errors because the Replit PG had no tables. Supabase dev has all 408+ tables.

**Previous reasoning (now secondary):** Startup chain with 30+ migrations each with 10 retries hammers pgBouncer during restarts → "too many authentication failures". If this becomes an issue again, set `SUPABASE_DATABASE_URL_DEV` to the Replit native PG URL.

**How to apply:** If dev startup hits ECIRCUITBREAKER, `rm -f /tmp/db-startup-cb.json` before restarting. If it persists, set `SUPABASE_DATABASE_URL_DEV=postgresql://postgres:password@helium/heliumdb` to force Replit native PG first again.

## Missing tables added manually (not in migration files)
These tables were missing from Supabase dev and were created via direct SQL:
- `freight_ports`
- `freight_carriers`  
- `freight_container_types`
- `ocean_freight_route_matrix`

Source schema: `lib/db/src/schema/freightMasterData.ts`

## Two separate Supabase projects — dev and prod are NOT the same instance
`SUPABASE_DATABASE_URL_DEV` (project `xssrfshdrtdfupgqwfdw`) and the prod DB reachable via
`SUPABASE_MIGRATION_URL`/`SUPABASE_DATABASE_URL` (project `nzdweipzckfszczzqtuw`) are two
**different** Supabase projects, not the same shared instance. As of 2026-07-02, dev is
several migrations behind prod (`__drizzle_migrations` only has 0000, 0001, 0010, 0011, 0012 —
missing 0013–0016), and the entire `mkt_rfqs` marketplace table (plus its dependent tables)
does not exist in dev at all — it was apparently created directly against prod via
`drizzle-kit push` and never checked into a migration file, so it never reached dev.

**Why this matters:** you cannot assume the live running dev workflow's DB has the same
schema as prod. Always check `to_regclass('public.<table>')` on the actual DB the workflow
connects to (`SUPABASE_DATABASE_URL_DEV`) before writing test/curl-based verification steps —
don't assume prod schema state applies.

**How to apply:** to test logic that depends on prod-only tables without deploying schema
changes to shared dev, build/bundle the relevant service module with esbuild (external:
pg, drizzle-orm, express, pino, dotenv, @supabase/*) targeting ESM (lib/db uses top-level
await) and run it with `SUPABASE_DATABASE_URL_DEV` overridden to the prod connection string
for that one-off process only — never point the live dev workflow itself at prod.
