---
name: ERP Core Hardening P1-P7
description: Key decisions and gotchas from implementing accounting hardening for production-grade ERP
---

## What was built

Seven hardening priorities in `artifacts/api-server/src/routes/bankMutationImport.ts` + new DB tables + new route file.

## Key decisions

**P1 — Unpost uses VOID, not DELETE**
- `accounting_entries` now has `entry_status`, `voided_by`, `voided_at`, `void_reason` columns.
- Unpost route: `UPDATE ... SET entry_status='VOID'` instead of DELETE.
- `entry_status DEFAULT 'POSTED'` — existing rows not affected.
- **Why:** Immutable journal audit trail; deleting journals loses forensic evidence.

**P2 — COA versioning: fallback chain**
- `resolveCoaMapping()` now accepts `txDate` + `companyId` params.
- Lookup order: `master_coa_mapping_versioned` (date-range, company-specific) → `master_coa_mapping` (legacy fallback).
- 30 rows migrated from legacy table as global (company_id=NULL) versions.
- `cachedResolveCoaMapping` passes `txDateForCoa` through.
- **Why:** Historical re-posting must use COA valid at transaction date, not current.

**P3 — Period lock is per company+month+year**
- `financial_periods` table has `is_closed` + `override_allowed` flag.
- `override_allowed=TRUE` bypasses the lock (SUPER_ADMIN use case).
- If table doesn't exist yet, `checkPeriodLock()` returns `locked:false` gracefully.
- **Why:** Month-end close must block new postings to closed periods.

**P4 — Intercompany mirror only if erpCategory starts with INTERCOMPANY_LOAN**
- Only triggered when `erpCategory.toUpperCase().startsWith("INTERCOMPANY_LOAN")`.
- Mirror uses reversed DR/CR lines for target company's journal.
- Requires `row.counterparty_company_id` to be set on the import row.
- Records link in `intercompany_mirrors` table.
- If target company has no bank journal, mirror is skipped (PENDING status).
- **Why:** Atomic double-entry across companies; both sides must balance.

**P5 — normalized_entries is now a VIEW**
- Dropped `bank_mutation_normalized_entries` table (was 0 rows).
- Replaced with VIEW computed from `bank_mutation_import_rows`.
- `copyBatchToNormalized()` is now a no-op (early return) to avoid INSERT failures.
- Dead code body preserved under `// eslint-disable-next-line no-unreachable` for reference.
- **Why:** No persistence needed; VIEW always reflects current state.

**P6 — Balance validation before postEntry**
- `validateJournalBalance()` checks SUM(DR) = SUM(CR) with 0.001 tolerance.
- On fail: row status → `FAILED`, loop continues (non-blocking for other rows).
- Error code: `UNBALANCED_JOURNAL_BLOCKED`.
- **Why:** Prevents corrupt double-entry from reaching the ledger.

**P7 — Audit events in audit_accounting_events**
- `logAccountingEvent()` called after every POST and VOID.
- Stores before/after state as JSONB, journal_id, company_id, erp_category, amount.
- All failures are non-fatal (wrapped in try/catch).
- **Why:** Full traceability for SOX/PSAK compliance.

## New API endpoints

`GET/POST/PATCH/DELETE /api/accounting/periods` — financial period management (admin only)
`GET /api/accounting/periods/audit` — audit event log
`GET /api/accounting/periods/coa-versions` — COA version history
`POST /api/accounting/periods/coa-versions` — add new COA version (closes old one)

## master_coa_mapping legacy table

The legacy table has NO `company_id` column. When migrating rows to versioned table, use `company_id=NULL` (global mapping). Only `master_coa_mapping_versioned` has company-specific records.
