---
name: Enterprise DB Patch Phase 2
description: Phase 2 FK+index completion; Drizzle sql.raw DO-block dollar-quoting bug and fix pattern
---

## Rule
Phase 2 boot migration (runPhase2Migration) added 22 FK constraints (NOT VALID) + 14 indexes across core tables. fk_mkt_vq_vendor and fk_rfq_vl_vendor missing from dev (dropped during debug; will recreate on next boot).

## Drizzle sql.raw DO-block bug
`sql.raw(`DO $$ BEGIN ... END $$`)` — Drizzle mangles `$$` → `$` in the SQL string sent to pg, producing PG syntax error.

**Fix:** Avoid DO blocks entirely. Use three separate `db.execute()` calls:
1. `db.execute(sql`SELECT 1 FROM pg_constraint WHERE conname = ${name} LIMIT 1`)` — parameterized existence check
2. `db.execute(sql.raw(`SELECT 1 FROM pg_constraint c JOIN pg_attribute a ... LIMIT 1`))` — equivalent-FK check
3. `db.execute(sql.raw(`ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ... NOT VALID`))` — DDL

This pattern is also correct for pgBouncer transaction mode (each call = one SQL statement).

## NOT VALID FK pattern
All Phase 2 FKs added as NOT VALID — enforces referential integrity on new writes, skips existing-row scan.
Run `ALTER TABLE <t> VALIDATE CONSTRAINT <name>` manually after confirming orphan counts on prod are 0.

## ON DELETE for NOT NULL FK columns
NOT NULL columns must use `ON DELETE NO ACTION` (not `SET NULL`).
Affected: `expenses.company_id`, `mkt_vendor_quotes.vendor_id`, `rfq_vendor_links.vendor_id`.
Always query `information_schema.columns.is_nullable` before choosing ON DELETE action.
