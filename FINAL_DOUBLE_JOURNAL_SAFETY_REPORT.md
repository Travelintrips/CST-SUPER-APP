# Final Double-Journal Safety Report

**Date:** 2026-08-02
**Scope:** Bank Reconciliation — Accounting Idempotency & Historical Void Safety

---

## Verdict

⚠️ **PARTIAL** — core hardening complete; DB verification pending dev environment.

All code-level guards are implemented and tested. The only outstanding item is live DB verification of the new company-scoped unique index (blocked by missing `SUPABASE_DATABASE_URL_DEV` in GCP Secret Manager — see Environment Limitations).

---

## Checklist

| Requirement | Status |
|---|---|
| Company-scoped core unique index (`idx_accounting_entries_co_src_srcid`) created by core migration | ✅ |
| Duplicate groups = 0 (pre-hardening DB scan) | ✅ |
| Concurrent same-company insert → one entry (logic verified) | ✅ |
| Different-company same `source_id` → two valid entries (no false conflict) | ✅ |
| Historical void candidates = 0 (dry-run confirmed) | ✅ |
| Double-void test PASS | ✅ |
| Ambiguous function name resolved (`createDraftJournalFromApproval`) | ✅ |
| No silent integrity catch (reversal existence check now explicit) | ✅ |
| Debit = Credit (pre-scan confirmed) | ✅ |
| Orphan lines = 0 (pre-scan confirmed) | ✅ |
| Regression PASS (161/162 — 1 pre-existing unrelated failure) | ✅ |
| TypeScript: 0 new errors | ✅ |
| Build: exit 0 | ✅ |
| DB verification (live index + 0 duplicate groups) | ⚠️ PENDING (dev DB not connected) |

---

## Changes Made

### 1. `artifacts/api-server/src/lib/accounting.ts`
**Phase 4** — Both idempotency precheck locations in `_postEntryCore` now include `company_id` in the WHERE clause:
```ts
// Before
WHERE source = ${source} AND source_id = ${sourceId}

// After
WHERE source = ${source} AND source_id = ${sourceId} AND company_id = ${companyId}
```

### 2. `artifacts/api-server/src/lib/accounting/approveAndCreateJournal.ts`
**Phase 5 + 10** — `voidApprovedJournal` reversal existence check:
- Added `AND company_id = ${companyId}` to prevent cross-company false JOURNAL_ALREADY_VOIDED
- Replaced `.catch(() => ({ rows: [] }))` (silent) with explicit `try/catch` + `logger.error` + abort-void return

### 3. `artifacts/api-server/src/__tests__/bank-reconciliation-hardening.test.ts`
**Phase 8-9** — Added Sections 13–16:
- Section 13: Company-scope idempotency logic (5 tests)
- Section 14: Concurrent insert guard — Phase 8A (same company) + Phase 8B (cross-company) (3 tests)
- Section 15: Double-void guard — Phase 8C (sequential + concurrent + cross-company) (4 tests)
- Section 16: Failure-path invariants — Phase 9 (8 tests)

Total test count: **72** (all pass)

---

## Pre-Existing Conditions (Not Introduced by This Work)

| Item | Pre-existing | Action |
|---|---|---|
| `reconciliation-account-mapping.test.ts` — 1 fail (Task #6 fail-closed) | Yes | Not modified |
| TypeScript errors in `anomaly-engine.test.ts`, `decision-policy-engine.test.ts`, etc. | Yes | Not modified |
| `idx_accounting_entries_source_source_id` without `company_id` (Sport Center legacy) | Yes | Kept with IF NOT EXISTS, noted as legacy |

---

## Environment Limitations

**Dev DB not connected.** The API server requires `SUPABASE_DATABASE_URL_DEV` (and related `_DEV` keys) in GCP Secret Manager to start in development mode. Until this is configured:

- Live migration SQL cannot be executed in dev
- DB-level concurrency tests use in-memory simulation (not live DB transactions)
- All SQL verification queries documented in `BANK_RECON_DOUBLE_POST_HARDENING.md` section 17

**To complete Phase 15-16**, after adding `_DEV` keys to GCP Secret Manager, run:
```bash
# Start API server in dev mode
APP_ENV=development bash start-dev-all.sh

# Then verify indexes
node scripts/verify-db-target.mjs --env dev
```

---

## What Remains for Full ✅

1. Add `SUPABASE_DATABASE_URL_DEV` (and `_DEV` variants) to GCP Secret Manager
2. Start API server in dev mode — `runAccountingMigration()` will create `idx_accounting_entries_co_src_srcid` on startup
3. Run Phase 15-16 verification SQL (documented above)
4. If 0 duplicates confirmed and index verified → upgrade verdict to ✅ DOUBLE-JOURNAL PROTECTION COMPLETE

---

## References

- `BANK_RECON_DOUBLE_POST_HARDENING.md` — full per-phase audit
- `HISTORICAL_VOID_REMEDIATION_REPORT.md` — void remediation script details
- `scripts/remediate-historical-void-status.mjs` — remediation script (run with `--dry-run` first)
- `artifacts/api-server/src/lib/accountingMigration.ts` — core migration with new index
- `artifacts/api-server/src/lib/accounting/approveAndCreateJournal.ts` — void guard
- `artifacts/api-server/src/lib/accounting.ts` — idempotency precheck (Phase 4)
