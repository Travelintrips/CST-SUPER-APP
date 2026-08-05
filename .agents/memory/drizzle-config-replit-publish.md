---
name: Drizzle config URL order for Replit publish
description: Why DATABASE_URL must be first in drizzle.config.ts resolveUrl() to prevent Replit's publish migration system from trying to apply the full Supabase schema to the Neon production PostgreSQL.
---

## The Rule
In `lib/db/drizzle.config.ts`, `DATABASE_URL` (Replit local PostgreSQL) must be first in the `resolveUrl()` candidates array — before `SUPABASE_MIGRATION_URL`.

## Why
Replit's publish migration system uses `drizzle.config.ts` to introspect the "dev" schema. If `SUPABASE_MIGRATION_URL` is first, it connects to Supabase (137 tables + 52 enum types) and tries to apply that full schema to the Neon production PostgreSQL. This generates 526 CREATE statements that fail with "Migrations failed validation / conflict with existing production data".

With `DATABASE_URL` first, it reads the local Replit PostgreSQL (which only has service_circuit_states and service_registry). Since prod Neon also has the same two tables, the diff is `hasDiff: false` → no migration runs → publish succeeds.

## How to Apply
- Keep `DATABASE_URL` first in `resolveUrl()` candidates
- The local Replit dev PostgreSQL must contain ONLY the watchdog tables (service_circuit_states, service_registry) — NOT the full app schema
- The app schema lives in Supabase; lib/db/src/schema/index.ts is still intact for TypeScript type checking
- `scripts/apply-migrations.mjs` applies SQL files to Supabase directly (not via drizzle.config.ts)
- Both tables must match prod structure exactly (no extra DEFAULTs, same FK constraints)

## Watchdog Table Structure (prod Neon, must match dev)
service_registry: service_name PK, display_name, url, health_path, weight (NO defaults on last two), is_frontend DEFAULT false, dependencies DEFAULT '[]', is_active DEFAULT true, sort_order DEFAULT 0, created_at/updated_at DEFAULT now()

service_circuit_states: service_name PK + FK→service_registry, state DEFAULT 'CLOSED', failure_count DEFAULT 0, last_state_change DEFAULT now(), opened_at nullable (no default)

## Recovery After dev PostgreSQL Reset
If the dev local PostgreSQL is ever reset/emptied, recreate the watchdog tables with the exact structure above before attempting to publish:
```sql
CREATE TABLE service_registry (
  service_name TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  url TEXT NOT NULL,
  health_path TEXT NOT NULL,
  weight INTEGER NOT NULL,
  is_frontend BOOLEAN NOT NULL DEFAULT false,
  dependencies JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE service_circuit_states (
  service_name TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'CLOSED',
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_state_change TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_at TIMESTAMPTZ,
  CONSTRAINT service_circuit_states_service_name_fkey 
    FOREIGN KEY (service_name) REFERENCES service_registry(service_name)
);
```
