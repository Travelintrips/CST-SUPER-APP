---
name: accounting_entries missing is_voided/is_reversed columns
description: journalReuseEngine queries COALESCE(ae.is_voided) and COALESCE(ae.is_reversed) on accounting_entries — these columns must be added at startup or every sport-payment approve triggers MANUAL_REVIEW_REQUIRED.
---

## Rule
`accounting_entries` table was created without `is_voided` and `is_reversed` columns.
The Universal Journal Reuse Engine (`journalReuseEngine.ts`) queries these via `COALESCE(ae.is_voided, FALSE)` in every source adapter.
If the columns are missing, PostgreSQL throws "column does not exist" → FAIL-CLOSED handler returns `MANUAL_REVIEW_REQUIRED` → frontend shows "Review Manual Diperlukan" + "Buat Proposal COA" even when a perfect candidate and COA are already found.

## Fix applied
Added to `runBankReconciliationStartup()` in `artifacts/api-server/src/routes/bankReconciliation.ts`:
```sql
ALTER TABLE accounting_entries ADD COLUMN IF NOT EXISTS is_voided   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE accounting_entries ADD COLUMN IF NOT EXISTS is_reversed BOOLEAN NOT NULL DEFAULT FALSE;
```
Idempotent — safe to run every startup.

**Why:** The engine is FAIL-CLOSED by design; any SQL error routes to MANUAL_REVIEW_REQUIRED. So a missing column is invisible in normal operation (no obvious error log at the approve action) and only surfaces as a false positive warning.

**How to apply:** If a new environment/DB is created and `accounting_entries` is missing these columns, the startup migration in `bankReconciliation.ts` will add them automatically on first API start. No manual intervention needed.
