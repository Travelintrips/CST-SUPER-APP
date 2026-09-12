# R-1 — Accounting Entry Dedup Index

## Summary
Added a **company-scoped** unique index on `accounting_entries` to prevent duplicate GL entries for the same financial event within a single company, while allowing the same source event to be recorded in different companies (correct multi-tenant behaviour).

## Problem
The original index `idx_accounting_entries_source_source_id` was a UNIQUE constraint on `(source, source_id)` **without `company_id`**. This had two critical flaws:

1. **Cross-company blocking**: The same source event ID could not exist in two different companies, preventing correct multi-tenant isolation.
2. **Wrong scope**: A duplicate entry in Company A would be blocked, but a legitimate entry in Company B for the same event would also be blocked.

A second index `idx_accounting_entries_co_src_srcid` was created as a partial fix but used a `source::text` cast that is not `IMMUTABLE` on some PostgreSQL versions, causing silent index creation failure.

## Fix
### New canonical index
```sql
CREATE UNIQUE INDEX IF NOT EXISTS accounting_entries_company_source_source_id_uniq
  ON accounting_entries (company_id, source, source_id)
  WHERE source IS NOT NULL
    AND source_id IS NOT NULL
    AND source <> 'manual'::accounting_entry_source;
```
Key points:
- **Includes `company_id`** — uniqueness is scoped per company.
- **Compares against the typed enum literal** `'manual'::accounting_entry_source` (IMMUTABLE), not `source::text <> 'manual'`.
- **Excludes `manual` source** — manually created journal entries have no source event so uniqueness cannot be enforced by source_id.

### Dropped legacy indexes
| Index name | Reason |
|---|---|
| `idx_accounting_entries_co_src_srcid` | Used non-IMMUTABLE `source::text` cast; silently failed on some PG versions |
| `accounting_entries_source_uniq` | Non-scoped duplicate of the above |
| `idx_accounting_entries_source_source_id` | Non-company-scoped; blocks cross-company entries |

### Files changed
- `artifacts/api-server/src/lib/accountingMigration.ts` — drops all legacy indexes; creates new company-scoped index
- `artifacts/api-server/src/modules/sport-center/migration.ts` — no longer re-creates the legacy unscoped index; instead drops it

## Test coverage
`artifacts/api-server/src/__tests__/r1-dedup-index.test.ts`

| Test | Verifies |
|---|---|
| A | New company-scoped index exists in live DB |
| B | Old `idx_accounting_entries_co_src_srcid` is absent |
| C | Same source+source_id in different companies → both accepted |
| D | Same company+source+source_id → second insert rejected |
| E | `manual` source: multiple entries allowed (excluded from index) |

## Runtime behaviour
- Migration runs at API server startup via `runAccountingMigration()`.
- `DROP INDEX IF EXISTS` calls are idempotent — safe to re-run.
- No data migration required — index is additive; no existing rows are deleted or modified.

## Pre-existing orphan investigation
Phase 12 baseline showed **≤ 1** posted entry without journal lines (pre-remediation legacy row from sport-center booking path). This row predates R-1 and is documented but not deleted as it carries historical financial data. All entries created after the R-1 fix will satisfy the uniqueness constraint.
