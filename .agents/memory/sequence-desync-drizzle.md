---
name: Drizzle v0.45 Serial Sequence Desync
description: Drizzle v0.45+ explicitly includes `id DEFAULT` in INSERT column list; sequences that were never used (populated by bulk import with explicit IDs) collide → "duplicate key violates unique constraint".
---

## The Rule

Any table populated via bulk SQL import (with explicit IDs) without using the sequence needs its sequence reset before Drizzle v0.45+ INSERTs can succeed.

## What Changed

- **Old Drizzle** (≤0.44): `INSERT INTO t ("entry_id", "account_id", ...) VALUES ($1, $2, ...)` — `id` column omitted, PostgreSQL used DEFAULT silently.
- **New Drizzle** (v0.45+): `INSERT INTO t ("id", "entry_id", "account_id", ...) VALUES (DEFAULT, $1, $2, ...)` — `id` explicitly listed with DEFAULT. PostgreSQL consumes sequence. If sequence is behind max(id), immediate collision.

## Affected Tables (dev DB, fixed August 2026)

- `accounting_entry_lines`: sequence was at `11`, max ID was `3305` → reset to `3305`
- `accounting_entries`: sequence was at `31`, max ID was `28270` → reset to `28270`

**Why:** Rows were bulk-imported via migration/seed scripts with explicit IDs, bypassing the sequence.

## Fix Applied

`syncAccountingSequences()` function added to `accountingMigration.ts` and wired to run on every API server startup (before `repairKasErSportCenterEntries` and `repairOrphanedEntryLines`). Uses `setval(seq, MAX(id))` to sync.

**Why:** Startup sync is idempotent. If sequences are already in sync, `setval` to current max is a no-op in effect. Prevents future regressions if any import re-adds rows with explicit IDs.

## Error Surfacing Fix

`unifiedMatchingEngine.ts` catch block now unwraps Drizzle wrapper errors:
```ts
const rootMsg = (e as any)?.cause?.message ?? e.message;
```
Previously, `e.message` was `"Failed query: INSERT INTO ..."` (Drizzle wrapper), hiding the real PostgreSQL error from the toast. Now the actual PG error (e.g. "duplicate key...") is shown to the user.

## Production Status

Production DB sequences were in sync at time of fix (seq = max_id). No action needed for production.
