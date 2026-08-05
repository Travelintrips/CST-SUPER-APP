---
name: Supabase pgBouncer search_path
description: pg Pool must include options='-c search_path=public' or DDL fails with error code 3F000
---

## Rule
When connecting to Supabase via pgBouncer (transaction mode), always add `options: '-c search_path=public'` to the pg Pool config.

## Why
pgBouncer in transaction mode does not preserve `search_path` between connections/transactions. Without it, `CREATE TABLE IF NOT EXISTS ...` fails with PostgreSQL error code `3F000` ("no schema has been selected to create in"), even though `drizzle-kit push` succeeds because it uses a direct Postgres connection (not pgBouncer).

## How to apply
In `lib/db/src/index.ts`, the Pool config includes:
```ts
options: '-c search_path=public',
```
Fix is permanent — do not remove this line.
