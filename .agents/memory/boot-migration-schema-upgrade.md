---
name: Boot migration schema upgrade pattern
description: CREATE TABLE IF NOT EXISTS skips existing tables — new columns never get added. Always add ALTER TABLE ADD COLUMN IF NOT EXISTS after each CREATE TABLE block in boot migrations.
---

## Rule

When a boot migration does `CREATE TABLE IF NOT EXISTS`, the statement is a no-op if the table already exists (from a previous migration version with different schema). Any new columns defined in the CREATE TABLE body are silently ignored for existing tables.

**Fix**: After every `CREATE TABLE IF NOT EXISTS` block, add `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for every column that might not exist in older instances of the table. Wrap each ALTER in `.catch(() => {})` for full idempotency.

**Why:** Multiple tables (`ledger_snapshots`, `ledger_events`, `master_coa_mapping`) were created in older schema versions without newer columns (`account_id`, `period`, `keyword`). Boot migrations tried to CREATE INDEX on those columns → failed with "column does not exist" → crashed the migration.

**How to apply:**
- In `financialClosingMigration.ts` and `sapHardeningMigration.ts` (and any future boot migration), after each `CREATE TABLE IF NOT EXISTS`:
  ```ts
  await db.execute(sql`CREATE TABLE IF NOT EXISTS foo (
    id SERIAL PRIMARY KEY,
    new_col TEXT
  )`);
  // Always add this block:
  await db.execute(sql`ALTER TABLE foo ADD COLUMN IF NOT EXISTS new_col TEXT`).catch(() => {});
  ```
- Also wrap `CREATE INDEX IF NOT EXISTS` in `.catch(() => {})` as a safety net.
- Similarly wrap `ALTER TABLE ADD COLUMN IF NOT EXISTS` in `.catch(() => {})` so it's safe to re-run.
