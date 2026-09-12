---
name: Cash advance type normalization
description: Non-canonical cash_advances.type values (e.g. 'employee_kasbon') silently misclassify as talangan; boot migration backfill is idempotent but slow.
---

## Rule
`cash_advances.type` is only ever meant to hold the canonical bucket values `'kasbon'` or `'talangan'`. Any exact-match filter/comparison against `type` (SQL `=`, JS `===`) will silently drop rows with a non-canonical literal (seen in the wild: `'employee_kasbon'`, manually inserted/seeded test data — no code path in the repo generates this literal).

**Why:** Exact-match filtering elsewhere in the codebase (GET list endpoints, dashboard counters, client-side `.filter()`) treated any non-`'kasbon'` value as `'talangan'` by default in some places and as "excluded entirely" in others (dedicated per-type pages), producing both a miscount AND unmanageable orphan records with zero user-facing error.

**How to apply:** Any code reading/writing `cash_advances.type` should bucket by substring (`type ILIKE '%kasbon%'` server-side, `.includes('kasbon')` client-side) rather than exact match, OR rely on the boot migration in `runAdvanceMigration()` (`artifacts/api-server/src/routes/advances.ts`) which normalizes all rows to canonical values on every server start. This backfill is idempotent (`WHERE type <> 'kasbon'` / `<> 'talangan'` guards) — safe to run repeatedly, including in production after deploy.

## Boot migration timing gotcha
The full startup migration chain in `artifacts/api-server/src/index.ts` runs 40+ sequential `runWithRetry(...)` migrations awaited one after another, each with real DB round trips. Reaching a migration positioned in the middle/end of the chain (like `runAdvanceMigration`) can take 5-6+ minutes after "Server listening" is logged. Don't conclude a boot migration "didn't run" from a quick post-restart check — wait several minutes or verify via direct DB query before assuming the fix failed.
