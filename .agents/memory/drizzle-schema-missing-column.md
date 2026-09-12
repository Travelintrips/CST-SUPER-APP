---
  name: Drizzle schema missing columns silently drop data
  description: Columns added via raw SQL/inline migration but not declared in Drizzle schema are silently excluded from db.select() results.
  ---

  If a column is added to a Postgres table only via a raw `ALTER TABLE ... ADD COLUMN` (inline migration in `ensureTables()`), but the corresponding Drizzle `pgTable()` schema definition is never updated to declare that field, then `db.select().from(table)` will silently omit it from the returned object — the field will be `undefined` even though the column has real data in Postgres.

  **Why:** Drizzle generates its SELECT column list from the schema definition, not `SELECT *`. Raw-SQL routes (`db.execute(sql`SELECT ca.* ...`)`) will show the column fine, creating a confusing split where "detail" endpoints (raw SQL) show correct data but "action" endpoints (Drizzle select) silently fail validation checks against that same column (e.g. cashAdvances `receiptUrl`/`ocrRawData` were added via inline migration but missing from `cashAdvancesTable` schema, causing `/settle` to always reject with "upload receipt first" even after a successful upload).

  **How to apply:** Whenever adding a new column via inline/raw migration to a table already used with `db.select().from(table)` elsewhere in the codebase, add the matching field to the Drizzle `pgTable()` schema in the same change — never add only the DB column. Symptom to watch for: a raw-SQL detail endpoint shows a value correctly, but a Drizzle-select action endpoint treats it as always-empty.
  