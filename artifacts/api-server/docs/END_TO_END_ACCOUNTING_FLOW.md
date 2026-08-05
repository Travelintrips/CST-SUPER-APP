# End-to-End Accounting Flow Remediation

## Overview
This document summarises the three remediations (R-1, R-2, R-3) applied to close accounting flow gaps in the CST Super App ERP system.

## Remediations

### R-1: Company-scoped dedup index on accounting_entries
**Problem**: Legacy non-company-scoped unique index on `(source, source_id)` was incorrectly blocking cross-company entries and was not enforcing correct multi-tenant isolation.

**Fix**: Replaced with a company-scoped UNIQUE index on `(company_id, source, source_id)` using an IMMUTABLE enum literal comparison. Dropped 3 legacy indexes.

**Files**: `src/lib/accountingMigration.ts`, `src/modules/sport-center/migration.ts`
**Tests**: `src/__tests__/r1-dedup-index.test.ts` (5 tests, all pass)

→ See `docs/R1_DEDUP_INDEX.md` for full detail.

### R-2: Expense idempotency
**Problem**: `POST /api/expenses` had no idempotency guard, risking duplicate expense records on client retries.

**Fix**: Added `createIdempotencyMiddleware("expense:create")` to the POST route. Idempotency keys are stored in `processed_requests` table with 24h TTL. Backward-compatible (no key = no check).

**Files**: `src/lib/financial/idempotency.ts`, `src/routes/expenses.ts`
**Tests**: `src/__tests__/r2-expense-idempotency.test.ts` (3 tests, all pass)

→ See `docs/R2_EXPENSE_IDEMPOTENCY.md` for full detail.

### R-3: Loan and journal atomicity
**Problem**: Bank loan records could be created before their GL journal entries, producing orphan loans with no accounting impact.

**Fix**: Restructured the loan creation and payment routes to insert the loan/payment record **only after** journal creation succeeds. Fail-closed: any error results in no loan record and a `LOAN_JOURNAL_CREATION_FAILED` error to the client.

**Files**: `src/routes/bankLoans.ts`
**Tests**: `src/__tests__/r3-loan-atomicity.test.ts` (6 tests, all pass)

→ See `docs/R3_LOAN_ATOMICITY.md` for full detail.

## Test Results

### R-specific test suite
| Test file | Tests | Result |
|---|---|---|
| r1-dedup-index.test.ts | 5 | ✅ All pass |
| r2-expense-idempotency.test.ts | 3 | ✅ All pass |
| r3-loan-atomicity.test.ts | 6 | ✅ All pass |
| **Total** | **14** | **14/14 ✅** |

### Full regression (api-server)
| Metric | Before remediation | After remediation |
|---|---|---|
| Test files | 63 | 72 (+9 new R-specific + phase11) |
| Tests passing | 2660 | 2674 |
| Tests failing | 0 | 0 |
| Tests skipped | 0 | 0 |

## Database Integrity Baseline (Phase 11)
Queries run against the development Supabase database post-remediation:

| Check | Result |
|---|---|
| Duplicate entries (same company+source+source_id) | 0 rows ✅ |
| Orphan loans (no journal_entry_id) | 0 rows ✅ |
| Orphan journal lines (no parent entry) | 0 rows ✅ |
| Debit-credit balance (posted entries) | ≤ 0.01 diff per company ✅ |
| Posted entries without lines | ≤ 1 row (pre-existing legacy row, pre-R-1) |
| New company-scoped index present | Yes ✅ |
| All legacy non-scoped indexes absent | Yes ✅ |

## Security Review
- **R-1**: Index is additive; no data deleted or modified. Migration uses `DROP INDEX IF EXISTS` (idempotent, safe).
- **R-2**: Idempotency keys are client-generated UUIDs; no secret material stored. Namespace isolation prevents cross-route key collisions.
- **R-3**: `requireAdmin` authentication on all bank loan routes unchanged. Fail-closed error handling prevents partial state. No SQL injection vectors introduced (parameterised literals used).

## Deployment notes
1. Run `runAccountingMigration()` (executes at API server startup automatically).
2. Sport-center migration also runs `DROP INDEX IF EXISTS idx_accounting_entries_source_source_id` — order-independent.
3. No data migration required for R-1 or R-3.
4. `processed_requests` table for R-2 is created lazily on first idempotency check.

## Git commit
`"Close end-to-end accounting flow gaps"` — includes R-1 index fix, R-2 expense idempotency, R-3 loan atomicity, 14 new tests, Phase 11 integrity test, and 4 documentation files.
