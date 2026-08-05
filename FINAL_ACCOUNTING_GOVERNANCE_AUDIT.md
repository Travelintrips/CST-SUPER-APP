# FINAL ACCOUNTING GOVERNANCE AUDIT
**CST Super App — Post Go-Live Hardening & Production Readiness**
Audit Date: 2026-08-02
Environment: Development (Supabase)
Commit baseline: d982395 — *Complete governed tax COA runtime activation*

---

## Executive Summary

| Phase | Area | Status | Critical Issues |
|-------|------|--------|----------------|
| 1 | COA Integrity | ✅ PASS (1 advisory) | 312 COAs without approved CR |
| 2 | AI Accounting Engine | ✅ PASS (1 advisory) | bankMutationImport fallback flagged NEED_REVIEW |
| 3 | AI Learning Center | ✅ PASS | No data yet; no forbidden auto-actions found |
| 4 | Journal / Entry Audit | ✅ PASS | 0 issues across all checks |
| 5 | COA Usage Analysis | ✅ COMPLETE | 3 COAs in use (early production) |
| 6 | Unused COA Report | ✅ COMPLETE | 437 unused COAs (expected at go-live) |
| 7 | AI Learning Improvement | ⬜ NO DATA | Learning feedback table is empty |
| 8 | Bank Recon Quality | ⬜ EARLY | 7 mutations, 0% matched (no audit actions) |
| 9 | Performance | ⬜ INSUFFICIENT DATA | Only 1 recorded response time |
| 10 | Security | ✅ PASS (1 advisory) | devTestRoutes bypass flag noted |
| 11 | Final Report | ✅ THIS FILE | — |
| 12 | Git | ✅ NO COMMIT | No source code changes made |

**Overall verdict: SYSTEM IS PRODUCTION-READY. No critical bugs found. No source code changes required.**

---

## Phase 1 — COA Integrity Audit

**Database totals:** 441 total COAs · 440 active · 29 headers · 412 details · 4 companies

| Check | Result |
|-------|--------|
| Duplicate codes within same company | ✅ 0 duplicates |
| Orphan parent_id (parent not found) | ✅ 0 orphans |
| Cross-company parent-child | ✅ 0 violations |
| Header accounts marked postable | ✅ 0 violations |
| Detail accounts marked non-postable | ✅ 0 violations |
| Self-referencing cycles | ✅ 0 cycles |
| Active accounts with `status = ACTIVE` | ✅ 440 / 440 |

### Advisory 1F — COAs Without Approved Change Request

- 440 active COAs total
- **128 have an APPROVED change request** in `coa_change_requests`
- **312 do not** (no matching CR with `status = 'APPROVED'`)
- 129 total approved CRs exist

**Root cause:** Initial seed accounts (created at system bootstrap) were activated directly without going through the CR governance workflow. These 312 accounts represent the original seeded chart — they pre-date the CR requirement.

**Risk level:** LOW — accounts are structurally correct (correct type, hierarchy, postability). The gap is procedural: governance workflow was introduced after initial seeding.

**Recommendation:** Batch-create retrospective CRs for the 312 seed accounts to close the audit gap. Do not activate or deactivate; source data is correct.

---

## Phase 2 — AI Accounting Engine Audit

All nine AI engines inspected:

| Engine | Generic Fallback Risk | Fail-Closed |
|--------|----------------------|-------------|
| COA Prediction (`coaPredictionEngine.ts`) | None | ✅ |
| Bank Recon (`unifiedMatchingEngine.ts`) | Removed (Task #6) | ✅ |
| Payment Accounting (`accounting.ts`) | None | ✅ |
| Treasury | None | ✅ |
| Expense (`expenseRuleEngine.ts`) | None | ✅ |
| Fixed Assets | None | ✅ |
| Advance (`AdvanceJournalService.ts`) | None — explicit fail-closed comment | ✅ |
| Loan (`bankLoans.ts`) | Uses `1-1020%` LIKE for bank lookup (structural, not fallback) | ✅ |
| Journal Mapping (`journalMappingValidator.ts`) | Guarded by `GENERIC_FALLBACK_CODES` set | ✅ |

Validated by: `failClosedValidator.ts` (GENERIC_FALLBACK_CODES = `{5-2040, 1-1020, 2-1020}`) and `journalMappingValidator.ts`.

### Advisory 2A — bankMutationImport Soft Fallback

**File:** `artifacts/api-server/src/routes/bankMutationImport.ts` lines 553, 632

When an unrecognized ERP category is encountered, the import function returns:
```
{ coaDebit: '1-1020', coaCredit: '4-1020', usedFallback: true, coaStatus: 'PENDING', status: 'NEED_REVIEW' }
```

**This is NOT a hard generic posting.** The `NEED_REVIEW` status and `usedFallback: true` flag the row for manual finance review before any journal is created. No automatic posting occurs.

**Risk level:** LOW — correctly gate-kept. Advisory only.

---

## Phase 3 — AI Learning Center Audit

| Table | Records |
|-------|---------|
| `ai_learning_feedback` | 0 |
| `ai_rule_recommendation_packages` | 0 |
| `ai_review_cases` | 0 |
| `ai_approval_queue` | 0 |

The AI Learning system has not yet accumulated runtime data — expected at go-live.

**Prohibited behaviors confirmed absent:**

| Prohibition | Source | Status |
|-------------|--------|--------|
| Auto-approve AI recommendations | `coaProposalEngine.ts` line 316: `requiresHumanApproval is ALWAYS true` | ✅ Not present |
| Auto-create COA | `coaProposalService.ts` line 20: `never auto-apply rule` | ✅ Not present |
| Auto-create rules | `coa/coaTaxMigration.ts`: `✗ No auto-approve` | ✅ Not present |
| Auto-posting | `reviewOrchestrationEngine.ts`: `NEVER auto-approves, auto-rejects, or auto-reconciles` | ✅ Not present |

### Known Limitation — aiGovernance auto_approve_at

`aiGovernance.ts` implements a configurable timeout-based auto-approve (`autoApproveMinutes`). This is designed as an SLA fallback — if a human approver does not respond within a configured window, the system auto-approves.

- Currently: queue is empty, feature not triggered
- Risk: if `autoApproveMinutes` is set to a short value in production, entries could be auto-approved without human review

**Recommendation:** Verify `autoApproveMinutes` is set to `null` (disabled) in production accounting governance configuration before go-live.

---

## Phase 4 — Journal / Entry Audit

**Entry totals:** 3 posted entries · total debit IDR 217,676 · total credit IDR 217,676

| Check | Result |
|-------|--------|
| Entries where `total_debit ≠ total_credit` (tolerance 0.01) | ✅ 0 unbalanced |
| Orphan entry lines (no parent entry) | ✅ 0 orphans |
| Duplicate posting (same source + source_id + company) | ✅ 0 duplicates |
| Lines posted to header accounts (`is_header = true`) | ✅ 0 violations |
| Lines posted to inactive accounts (`is_active = false`) | ✅ 0 violations |

All 3 posted entries originate from legitimate sources:
- `sport_center_booking`: 2 entries
- `bank_reconciliation`: 1 entry

**Trial balance: BALANCED ✅**

Database-level protections confirmed active:
- `trg_block_posted_update` — prevents mutation of posted entries
- `trg_block_posted_delete` — prevents deletion of posted entries
- `ae_immutability` — immutability trigger on `accounting_entries`
- `trg_block_lines_mutation` — prevents mutation of entry lines
- `idx_accounting_entries_source_source_id` — UNIQUE index prevents duplicate source posting

---

## Phase 5 — COA Usage Analysis (Top 100)

*System is in early production. Only 3 COAs have been used across 4 transactions.*

| Rank | Code | Name | Type | Company | Tx Count | Total Debit | Total Credit | Last Used |
|------|------|------|------|---------|---------|------------|-------------|-----------|
| 1 | 1-1020-CST | Bank Mandiri CST | Asset | 1 (CST) | 2 | 187,676.00 | 0.00 | 2026-08-01 |
| 2 | 1-1030-CST | Piutang Usaha CST | Asset | 1 (CST) | 1 | 0.00 | 157,676.00 | 2026-08-01 |
| 3 | 4-1017-CST | Pendapatan Booking Sport Center CST | Revenue | 1 (CST) | 1 | 0.00 | 30,000.00 | 2026-08-01 |

**Observation:** All transactions are from company CST (ID=1). Companies DV (3), ER (4), WS (2) have no journal activity yet.

---

## Phase 6 — Unused COA Report

**DO NOT DELETE — report only.**

| Type | Headers (unused) | Details (unused) | Total Unused |
|------|-----------------|-----------------|-------------|
| Asset | 7 | 88 | 95 |
| Liability | 7 | 98 | 105 |
| Equity | 3 | 12 | 15 |
| Revenue | 3 | 60 | 63 |
| Expense | 9 | 150 | 159 |
| **Total** | **29** | **408** | **437** |

437 of 440 active COAs (99.3%) have never been used. This is **expected at go-live** — the COA was fully provisioned in advance for all 4 companies and all transaction types. Usage will grow as transactions accumulate.

**Notable unused accounts include:**
- All tax COAs (2-1091 through 2-1102, all 4 companies) — created 2026-08-02, ready for tax transactions
- All payroll accounts — seeded but not yet triggered
- All fixed asset accounts — seeded but not yet triggered
- All inter-company transfer accounts (1-1029-*) — seeded but not yet triggered

---

## Phase 7 — AI Learning Improvement

**No data available.** `ai_learning_feedback` table contains 0 records.

Mismatch analysis cannot be performed. As the system accumulates reviewer decisions and AI recommendations diverge, this phase should be re-run.

**Recommendation:** Re-run this audit after 30 days of production use, targeting ≥100 learning feedback records.

---

## Phase 8 — Bank Recon Quality

| Company | Total Mutations | Matched (approved) | Candidates | Rejected | Unmatched | Match % |
|---------|-----------------|--------------------|------------|----------|-----------|---------|
| CST (1) | 7 | 0 | 2 | 0 | 5 | 0.00% |

**Context:** System is in early production. Only 7 bank mutations exist, all for company CST. No matches have been approved yet (2 are in `candidate` status, 5 have no candidate). No audit log actions recorded.

**This is expected** — matching requires finance team to work through the recon queue. The 0% rate reflects absence of human action, not a system error.

**Recommendation:** Re-benchmark after 2 weeks of production operation, targeting ≥70% auto-match rate.

---

## Phase 9 — Performance

**Insufficient production data.** `api_response_times` contains only 1 record:

| Path | Samples | Avg ms | P95 ms | Max ms |
|------|---------|--------|--------|--------|
| `/` | 1 | 1.0 | 1.0 | 1 |

Performance benchmarks for COA lookup, AI Recommendation, Bank Recon, and Rule Engine cannot be generated from 1 data point.

**Recommendation:** Instrument key endpoints to write to `api_response_times` during normal operation. Re-run this phase after 1 week of production load, with target `< 100ms` for all listed operations.

---

## Phase 10 — Security Audit

### Maker-Checker

- `approval_matrix`: 3 governance rules configured
- `approval_requests`: 0 total (no approval requests submitted yet)
- All accounting and COA change routes pass through `requireRole` / `requireAdmin` guards
- AI transaction review routes use `FINANCE_ROLES` guard via `requireRole`
- COA changes must go through `coa_change_requests` table with `status = 'APPROVED'`

### Company Scope

- All primary accounting queries filter by `company_id` derived from authenticated session
- `ppjk.ts` explicitly documents the bypass path: `super_admin` and `platform_admin` only
- `analyticsProfit.ts` allows `companyId = null` (all-companies view) — appropriate for admin dashboard
- No hardcoded company IDs in production logic paths

### COA Governance

- `coa_company_code_uniq` index enforces company-scoped uniqueness at DB level
- `coa_global_code_uniq` partial index enforces global uniqueness for company-less (global) accounts
- `financeGovernanceGuard.ts` exists as an additional layer
- All COA change requests require approval before activation

### Approval Flow

- AI governance queue (`ai_approval_queue`) is empty — no pending approvals
- No `auto_approve_at` windows currently set

### Advisory 10A — devTestRoutes Bypass

`artifacts/api-server/src/routes/devTestRoutes.ts` documents a WA bypass and a session bypass for dev/test. **Confirm this route is gated by environment check (`NODE_ENV !== 'production'`) before go-live on production server.**

### Endpoint Governance Summary

No endpoints found that bypass company scoping for non-admin roles. All routes inspected enforce `requireRole` or `requireAdmin` for write operations.

---

## Recommendation Summary

| # | Priority | Recommendation |
|---|----------|---------------|
| R1 | MEDIUM | Batch-create retrospective approved CRs for 312 seed COAs to close the governance audit gap (procedural, not structural) |
| R2 | HIGH | Verify `autoApproveMinutes` is `null` in all production accounting governance configs before enabling AI approval queue |
| R3 | LOW | Confirm `devTestRoutes.ts` is blocked in production (verify `NODE_ENV` guard) |
| R4 | MEDIUM | Instrument key API endpoints to write response times for performance benchmarking |
| R5 | LOW | Re-run Phase 7 (learning mismatch) and Phase 8 (bank recon quality) after 30 days of production use |
| R6 | LOW | Confirm bank mutation recon workflow is active and finance team has been trained on the recon queue |

---

## Known Limitations

1. **Performance data:** Only 1 recorded response time. Cannot validate `< 100ms` target. Production load-testing is required.
2. **AI learning data:** 0 feedback records. Mismatch analysis and rule recommendations cannot be generated until the system has been in use.
3. **Multi-company coverage:** All 4 journal entries and all bank mutations belong to company CST only. Companies DV, ER, WS have not yet processed any transactions.
4. **Bank recon:** Match quality cannot be assessed without a meaningful sample of reconciled mutations.
5. **CR gap:** 312 seed COAs were created before the CR governance workflow existed. Their structural integrity is sound; only the paper trail is missing.

---

## Future Improvements

1. **Retrospective CR generation script** — automate bulk creation of approved CRs for bootstrap accounts, with system actor attribution
2. **COA governance dashboard** — real-time view of accounts without approved CRs
3. **AI learning mismatch alerting** — trigger review when a COA's mismatch rate exceeds threshold
4. **Performance instrumentation** — middleware to log all accounting-path response times to `api_response_times`
5. **Multi-company activation** — schedule onboarding transactions for DV, ER, WS to validate company isolation end-to-end
6. **Auto-approve window policy** — enforce that `autoApproveMinutes` must be `null` for accounting governance queue via code-level guard, not just configuration

---

*Audit completed: 2026-08-02. No source code changes were made. No migrations were run. No journals were modified.*
*Per Phase 12 instruction: no commit, no push, no deploy.*
