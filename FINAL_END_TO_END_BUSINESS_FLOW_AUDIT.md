# FINAL END-TO-END BUSINESS FLOW AUDIT
## Bank Reconciliation, Accounting, Treasury, AI, COA Governance

**Date:** 2026-08-03  
**Mode:** READ-ONLY FORENSIC AUDIT  
**Auditor:** Replit Agent  
**Database:** Supabase dev (SUPABASE_DATABASE_URL_DEV)  
**Test Suite:** 2660/2660 PASS (69 files)

---

## 1. EXECUTIVE SUMMARY

The end-to-end business flow is substantially correct. Core accounting invariants hold: double journals = 0, debit = credit per company, orphan lines = 0, unbalanced entries = 0, all 129 COA change requests approved with 0 self-approval, AI never auto-approves or auto-posts.

Three required fixes were identified:

| ID | Severity | Summary |
|---|---|---|
| R-1 | HIGH | `idx_accounting_entries_co_src_srcid` is ABSENT from runtime DB; dedup index missing company_id scope |
| R-2 | MEDIUM | POST expense has no idempotency guard; double-click can produce duplicate expense + duplicate journal |
| R-3 | MEDIUM | `bank_loans.ts` saves loan record even when journal creation fails; not atomic |

Four advisory items were identified:

| ID | Severity | Summary |
|---|---|---|
| A-1 | MEDIUM | 3 bank mutations `status=posted` with no `bank_reconciliation_matches` entry (legacy direct-post path) |
| A-2 | MEDIUM | 1 posted `accounting_entries` row has 0 `accounting_entry_lines` (id=10, SCPAY-5, sport_center_booking, source_id=NULL) |
| A-3 | LOW | Admin users CAN self-approve COA proposals (`coaProposalService.ts` line 623: exemption for `isAdmin`) |
| A-4 | LOW | `resolveCompany.ts` falls back to `company_id=1` for admins without assigned company |

**Overall verdict: 🟡 FLOW VERIFIED WITH ADVISORY**

---

## 2. PHASE 1 — GIT & ENVIRONMENT BASELINE

| Item | Value |
|---|---|
| Branch | main |
| HEAD | cb01f45 — "Clean up replit configuration and refactor admin payment settings" |
| origin/main | cb01f45 (in sync) |
| Working tree | CLEAN — 0 uncommitted files |
| git diff --check | PASS (0 whitespace warnings) |
| Database | Supabase dev (SUPABASE_DATABASE_URL_DEV) |
| Test suite | 2660/2660 PASS |
| TypeScript | 0 errors |
| Build | Clean (16.7 MB bundle) |

---

## 3. PHASE 2 — SYSTEM ARCHITECTURE MAP

### A. Bank Reconciliation Flow

| Step | File/Service | Table |
|---|---|---|
| Google Sheet sync | `routes/bankReconciliation.ts` POST /sheet-sync | bank_mutations |
| CSV/Excel/MT940/CAMT053 import | `routes/bankReconciliation.ts` POST /import, /smart-import | bank_mutation_import_batches |
| Canonical key hash | `lib/reconciliation/canonicalMutationKey.ts` | bank_mutations.canonical_key |
| Dedup save | `routes/bankMutationImport.ts` POST /save | bank_mutations |
| Rule engine matching | `lib/reconciliation/` runReconDecisionStack | bank_reconciliation_matches |
| ERP document matching | `lib/reconciliation/bankAllocationMatching.ts` | bank_reconciliation_matches |
| Expected cash flow | `lib/reconciliation/unifiedMatchingEngine.ts` | bank_reconciliation_matches |
| Review | UI + `routes/bankReconciliation.ts` | bank_reconciliation_matches.status=candidate |
| Approve + draft journal | `approveAndCreateJournal` in unifiedMatchingEngine.ts | accounting_entries (draft) |
| Post | `POST /:mutationId/post` | accounting_entries (posted), ledger_entries |
| General Ledger | ledger_entries | ledger_entries |

### B. Application Transaction Flow

Invoice/Expense/Payment/Booking/Logistic Order → Business Approval → accounting_entries (draft/posted) → accounting_entry_lines → ledger_entries → bank_mutations (mutation link)

### C. AI Transaction Intelligence

| Phase | File |
|---|---|
| Transaction Understanding | `lib/ai/transaction-intelligence/transactionUnderstanding.ts` |
| Intent Classification | `lib/ai/transaction-intelligence/intentClassifier.ts` |
| COA Prediction | `lib/ai/transaction-intelligence/coaPredictionEngine.ts` |
| Explainability | `lib/ai/transaction-intelligence/coaCandidateRanker.ts` |
| Anomaly Detection | `lib/ai/transaction-intelligence/anomalyEngine.ts` |
| Review Orchestration | `lib/ai/transaction-intelligence/decisionPolicyEngine.ts` |
| Decision Policy | Phase 3 `primaryRecommendation` contract confirmed |
| Human Review | routes/aiReview.ts |
| Learning Feedback | routes/aiLearningCenter.ts → aiLearningFeedbackTable |
| Rule Recommendation | `lib/ai/transaction-intelligence/adaptiveRuleEngine.ts` |

### D. COA Governance

Missing COA → fail-closed → COA Proposal → Maker (requestedBy) → Checker (reviewedBy ≠ requestedBy) → `implementApprovedCoaProposal` → chartOfAccounts (ACTIVE) → mapping recommendation → Human approval

---

## 4. PHASE 3 — BANK MUTATION IMPORT FLOW

| Check | Result |
|---|---|
| Canonical key algorithm | SHA-256 of `company_id\|bank_account_id\|date\|debit_cents\|credit_cents\|normalized_desc\|bank_ref` ✓ |
| Mutation key | SHA-256 hash per import row ✓ |
| Same transaction → same key | Deterministic hash confirmed ✓ |
| Duplicate import_key | **0 rows** ✓ |
| Duplicate canonical_key | **0 rows** ✓ |
| Orphan mutations (no company) | **0** ✓ |
| Import idempotency | ON CONFLICT DO NOTHING on mutation_key ✓ |
| Company/bank scope | bank_account_id scoped ✓ |

---

## 5. PHASE 4 — TRANSACTION ALREADY EXISTS IN ACCOUNTING

Matching engine checks for existing accounting_entries linked to ERP sources (sport_center_booking, logistics_payment, etc.) before creating new journals. If a match is found, the mutation is linked to the existing entry rather than creating a new one. Double journal protection via `idx_accounting_entries_source_source_id` unique index (partial, without company_id — see R-1).

---

## 6. PHASE 5 — MUTATION FIRST FLOW

AI is read-only: `coaPredictionEngine.ts` line 16 and `decisionPolicyEngine.ts` line 173 explicitly state they NEVER post journals or auto-approve. `requiresHumanApproval=true` enforced in `adaptiveRuleEngine.ts` lines 17, 128, 202, 261, 289, 487.

Draft journals are created only after human approval (`approveAndCreateJournal`). Posting requires a second explicit step.

---

## 7. PHASE 6 — MATCHING ENGINE

| Check | Result |
|---|---|
| Rule engine | `runReconDecisionStack` in bankReconciliation.ts ✓ |
| ERP document matcher | `bankAllocationMatching.ts` with amount/date/ref scoring ✓ |
| Expected cash flow | Unified matching engine ✓ |
| Company scoped | resolveCompanyId from session ✓ |
| Candidate not cross-company | bank_account_id scoped per company ✓ |
| AI does not create journal | Confirmed read-only ✓ |
| Ambiguous → manual review | status=manual_review_required ✓ |
| Conflict → one approved match | MULTI_APPROVED_MATCH=0 ✓ |

---

## 8. PHASE 7 — APPROVAL FLOW

| Check | Result |
|---|---|
| SELECT FOR UPDATE on approve | Confirmed in unifiedMatchingEngine.ts and bankReconciliation.ts ✓ |
| SELECT FOR UPDATE on post | Confirmed in bankReconciliation.ts (bank_mutations + accounting_entries) ✓ |
| One approved match per mutation | MULTI_APPROVED_MATCH=0 ✓ |
| State machine violations | **⚠️ 3 mutations posted without match record (A-1)** |
| Authentication | requireAdmin / requireClerkUser ✓ |
| Company scope from session | resolveCompanyId confirmed ✓ |

**A-1 Detail:** Mutations id=27123, 27124, 27125 (date 2025-11-30) have status=posted with no bank_reconciliation_matches entry. They DO have accounting_entries (source=bank_reconciliation). These were likely posted via a legacy direct-post code path that created the journal but did not insert a match record. They are not accessible via the current standard approval flow; they are data-layer artifacts.

---

## 9. PHASE 8 — JOURNAL CREATION

| Source | Status |
|---|---|
| bank_reconciliation | ✓ via approveAndCreateJournal |
| sport_center_booking | ✓ (2 entries: id=8 correct, id=10 has 0 lines — **A-2**) |
| bank_reconciliation_void | ✓ reversal creates new entry |
| other sources | No data in dev DB yet |

**A-2 Detail:** Entry id=10 (ref=SCPAY-5, sport_center_booking, source_id=NULL) is posted with total_debit=total_credit=30,000 but has 0 accounting_entry_lines. The source_id is NULL which violates the invariant "one source → one journal" (source_id should always be set). This suggests a legacy or buggy code path that created a journal header without lines. The `ae_insert_guard` trigger would block new inserts without a source, but this row predates or bypassed that guard.

---

## 10. PHASE 9 — DOUBLE JOURNAL PROTECTION

| Check | Result |
|---|---|
| Duplicate (company_id, source, source_id) | **0 rows** ✓ |
| `idx_accounting_entries_source_source_id` | EXISTS — (source, source_id) without company_id ⚠️ R-1 |
| `idx_accounting_entries_co_src_srcid` | **NOT FOUND in runtime DB** ❌ R-1 |
| `accounting_entries_company_source_ref_uniq` | EXISTS ✓ |
| `accounting_entries_entry_number_unique` | EXISTS ✓ |
| Application precheck (validateJournalCreation) | Checks bank_mutations status ✓ |
| Row lock (SELECT FOR UPDATE) | Confirmed on post ✓ |

**R-1 Root Cause:** `accountingMigration.ts` creates `idx_accounting_entries_co_src_srcid` with WHERE clause containing `source::text <> 'manual'`. In PostgreSQL, when `source` is already an enum type (`accounting_entry_source`), casting to text in an index predicate may produce an error on startup ("functions in index predicate must be marked IMMUTABLE"). The actual runtime index `idx_accounting_entries_source_source_id` was created by Sport Center migration using the correct pattern `source <> 'manual'::accounting_entry_source`. The company-scoped index is absent from the DB.

---

## 11. PHASE 10 — POSTING & GENERAL LEDGER

| Check | Result |
|---|---|
| Immutability trigger | `ae_immutability` on posted entries (total_debit, total_credit, journal_id, date, source, source_id) ✓ |
| Period lock trigger | `ae_period_lock_insert_guard` ✓ |
| Period locks active | 0 periods locked (dev env) |
| Checksum hash field | Present on accounting_entries.checksum_hash ✓ |
| Void creates reversal | void_entry_id foreign key confirmed ✓ |
| Ledger entries | 0 rows in ledger_entries (dev env — no ledger event fired yet) |
| Duplicate ledger events | 0 ✓ |

---

## 12. PHASE 11 — ACCOUNTING EQUATION

| Company | Total Debit | Total Credit | Difference | Headers | Lines |
|---|---|---|---|---|---|
| 1 (CST) | Rp 561,146 | Rp 561,146 | **0.00** | 6 | 12 |

*Note: Direct column sum (total_debit/total_credit) = 591,146 because entry id=10 has column values but 0 lines. Line-sum = 561,146. Difference = 30,000 = A-2 entry.*

| Check | Result |
|---|---|
| Orphan lines | **0** ✓ |
| Unbalanced entries | **0** ✓ |
| Posted without lines | **1** ⚠️ A-2 (id=10, SCPAY-5) |
| Cross-company contamination | Companies 2–4 have 0 posted entries (dev env) |

---

## 13. PHASE 12 — TRIAL BALANCE & GENERAL LEDGER

- ledger_entries: **0 rows** (dev environment — no ledger events fired for these transactions)
- Trial balance via accounting_entry_lines: debit = credit per company ✓
- No duplicate account balances detected

---

## 14. PHASE 13 — BALANCE SHEET

| COA Classification | Evidence |
|---|---|
| Tax asset accounts (1-1070-{suffix}) | ACTIVE, is_header=true, is_postable=false ✓ |
| Tax liability accounts (2-1090-{suffix}) | ACTIVE, is_header=true, is_postable=false ✓ |
| 2-1060-CST (Intercompany) | Untouched, not in tax hierarchy ✓ |
| Headers not double-counted | is_header=true, is_postable=false enforced ✓ |
| Multi-company isolation | company_id scoped on all COA queries ✓ |

Company-level totals: only company 1 has posted accounting entries in dev env.

---

## 15. PHASE 14 — PROFIT & LOSS

| COA | Code | Status |
|---|---|---|
| Beban PPh Final atas Bunga Bank | 5-3044-{suffix} | ACTIVE, postable, parent=5-3040-{suffix} ✓ |
| Beban Pajak header | 5-3040-{suffix} | is_header=true, is_postable=false ✓ |
| INTEREST_TAX_WITHHOLDING intent | `intentClassifier.ts` → 5-3044 | Confirmed by coa-tax-hierarchy.test.ts ✓ |

Test scenario (Bunga Rp157,676 / Pajak Rp31,535): Confirmed INTEREST_TAX_WITHHOLDING → Beban PPh Final atas Bunga Bank (5-3044-{suffix}). AE id=9 (Rp157,676) and id=12 (Rp31,535) present in DB.

---

## 16. PHASE 15 — CASH FLOW

- fund_transfer accounting entries: 0 rows
- Internal transfer classification: fund_transfer source enum exists ✓
- No data in dev env for cash flow classification testing

---

## 17. PHASE 16 — TREASURY FLOW

| Check | Result |
|---|---|
| Company scoped | `resolveCompanyIdStrict` in treasury route ✓ |
| No fallback company 1 | `TreasuryAuthError` thrown instead of fallback ✓ |
| No unauthenticated access | `req.user` required ✓ |
| No auto journal | Confirmed read-only ✓ |
| No stale cache cross-company | Company-scoped cache keys ✓ |

---

## 18. PHASE 17 — EXPENSE FLOW

**R-2 Finding:** POST expense (routes/expenses.ts):
- `x-idempotency-key`: **NOT implemented**
- Expense + journal: **NOT in single transaction** (separate db.insert + postQuickExpenseJournal)
- If journal fails, expense remains in `draft` status — no full rollback
- `recordTransactionTax` is fire-and-forget (`void ... .catch(() => {})`)
- Double-click/network retry can produce duplicate expenses

| Runtime Check | Result |
|---|---|
| Duplicate expense_number | **0** ✓ (insertExpenseWithRetry guards expense_number uniqueness) |
| Expenses without entry_id (approved/posted) | 0 (no expenses in dev env) |
| Orphan entry_id | 0 ✓ |

---

## 19. PHASE 18 — VENDOR PAYMENT / AP

- ap_subledger table present
- No vendor payment data in dev env; architecture review only
- AP routes use `requireAdmin` + company scope from session ✓

---

## 20. PHASE 19 — CUSTOMER PAYMENT / AR

- ar_subledger table present
- No AR data in dev env; architecture review only

---

## 21. PHASE 20 — DANA TALANGAN / CASH ADVANCE

- advances.ts route present
- cashAdvances.ts route present
- No data in dev env for runtime check

---

## 22. PHASE 21 — FIXED ASSET

- No fixed asset flow in dev env runtime
- Architecture: Fixed asset purchase as capitalization (not expense) not verified at runtime

---

## 23. PHASE 22 — LOAN FLOW

**R-3 Finding:** `bankLoans.ts`:
- Loan insert and journal creation: **NOT in same transaction**
- Journal created first (line 134), then loan insert (line 161)
- Journal errors caught and logged but do not rollback loan
- `bank_loans.journal_entry_id` column confirmed
- No bank_loan source enum value (loans use direct journal_entry_id FK instead of source/source_id)

| Runtime Check | Result |
|---|---|
| Loans in DB | **0** (dev env empty) |
| Orphan journal_entry_id | 0 ✓ |

---

## 24. PHASE 23 — SPORT CENTER

| Check | Result |
|---|---|
| Revenue only once per booking | ✓ (source=sport_center_booking unique constraint) |
| AE id=8 (SC-0001) | 2 lines, balanced ✓ |
| AE id=10 (SCPAY-5) | **0 lines, source_id=NULL** ⚠️ A-2 |
| sport_center_booking_reversal source | Enum present ✓ |

---

## 25. PHASE 24 — LOGISTIC ORDERS

- logistic_vendor_cost and logistics_payment source enums present ✓
- No logistic order data in dev env

---

## 26. PHASE 25 — PPJK / CUSTOMS

- PPJK routes present (ppjkTenantIsolation tests: 15/15 PASS)
- Company isolation verified by ppjk-tenant-isolation.test.ts ✓

---

## 27. PHASE 26 — TAX COA RUNTIME

| Company | Header | Status | is_header | is_postable | approved_by |
|---|---|---|---|---|---|
| CST (1) | 1-1070-CST, 2-1090-CST, 5-3040-CST | ACTIVE | true | false | set ✓ |
| WS (2) | 1-1070-WS, 2-1090-WS, 5-3040-WS | ACTIVE | true | false | set ✓ |
| DV (3) | 1-1070-DV, 2-1090-DV, 5-3040-DV | ACTIVE | true | false | set ✓ |
| ER (4) | 1-1070-ER, 2-1090-ER, 5-3040-ER | ACTIVE | true | false | set ✓ |

5-3044-{suffix}: ACTIVE, is_postable=true, is_header=false, parent=5-3040-{suffix} all 4 companies ✓  
2-1060-CST: "Hutang Intercompany - PT Diva Servis" — UNTOUCHED ✓  
129 CRs APPROVED, 0 PENDING, 0 self-approval ✓

---

## 28. PHASE 27 — AI TRANSACTION INTELLIGENCE

| Phase | Status |
|---|---|
| Transaction Understanding | ✓ transactionUnderstanding.ts |
| Intent Classification | ✓ intentClassifier.ts (INTERNAL_TRANSFER, AR_REVENUE, INTEREST_TAX_WITHHOLDING confirmed) |
| COA Prediction | ✓ coaPredictionEngine.ts — read-only |
| No DB access in pure engine | ✓ Confirmed |
| No auto-approve | ✓ Confirmed (isAutoApproveConfigured fails-closed for null/<=0 autoApproveMinutes) |
| No auto-post | ✓ Confirmed |
| requiresHumanApproval=true | ✓ adaptiveRuleEngine.ts lines 17, 128, 202, 261, 289, 487 |
| Decision Policy | ✓ Phase 3 primaryRecommendation contract used |
| Company isolation | ✓ company_id scoped throughout |

---

## 29. PHASE 28 — AI LEARNING FLOW

| Check | Result |
|---|---|
| Feedback saved | aiLearningFeedbackTable ✓ |
| Min sample threshold | DEFAULT_MIN_OCCURRENCES=3, DEFAULT_MIN_CONSISTENCY=0.7 ✓ |
| Reviewer agreement | Calculated in learningEngine.ts ✓ |
| No auto-activation | requiresHumanApproval=true ✓ |
| autoApproveMinutes | fail-closed: null/undefined/<=0 all disable ✓ |
| Stale approval scheduler | expireStaleApprovals checks autoApproveMinutes ✓ |
| Statistics fix | .limit(500) added to packages query (pre-existing fix) ✓ |

---

## 30. PHASE 29 — AI COA PROPOSAL FLOW

| Check | Result |
|---|---|
| No auto-create | Confirmed: requires human submission ✓ |
| No direct master write without approval | implementApprovedCoaProposal only after status=APPROVED ✓ |
| No self-approval (non-admin) | Enforced coaProposalService.ts line 623 ✓ |
| Admin self-approval | ⚠️ A-3: Admins exempt from maker-checker check |
| Duplicate proposal detection | Version check + status guard ✓ |
| Version history | version field incremented on each change ✓ |

---

## 31. PHASE 30 — COA GOVERNANCE

| Check | Result |
|---|---|
| Maker ≠ Checker (non-admin) | ✓ |
| Company scoped | ✓ company_id on all COA entries |
| Atomic approval | ✓ transaction-wrapped implementApprovedCoaProposal |
| Startup migration doesn't overwrite | ✓ confirmed (coa-migration-restart.test.ts 28/28) |
| 0 PENDING CRs | ✓ |
| 129 APPROVED | ✓ |

---

## 32. PHASE 31 — RULE ENGINE

| Check | Result |
|---|---|
| Simulation read-only | ✓ |
| Rule not auto-activated | requiresHumanApproval=true ✓ |
| Company isolation | ✓ |
| autoApproveMinutes fail-closed | ✓ |
| Conflict detection | ✓ adaptiveRuleEngine.ts ✓ |

---

## 33. PHASE 32 — SECURITY & AUTHORIZATION

| Module | Auth | Company Scope |
|---|---|---|
| Accounting | requireAdmin/requireRole ✓ | session.companyId ✓ |
| Bank Recon | requireAdmin ✓ | resolveCompanyId ✓ |
| Treasury | resolveCompanyIdStrict ✓ (TreasuryAuthError) | strict — no fallback |
| AI Review | req.user + resolveCompanyId ✓ | session.companyId ✓ |
| COA Proposals | req.user + getActor ✓ | session.companyId ✓ |
| Expense | requireClerkUser/requireAdmin ✓ | session.companyId ✓ |
| Loan | requireAdmin ✓ | session.companyId ✓ |
| Dev routes | requireAdmin + APP_ENV=development ✓ (fail-closed) | — |

**A-4:** `resolveCompany.ts` falls back to `company_id=1` for admins without assigned company. A misconfigured admin account could inadvertently access company 1's data. COMPANY_CONTEXT_SWITCH audit log fires at HIGH severity when admin switches company.

---

## 34. PHASE 33 — PERMISSION MATRIX

| Role | Accounting | Bank Recon | Treasury | COA Gov | COA Props | AI Review | Learning |
|---|---|---|---|---|---|---|---|
| Admin | Full ✓ | Full ✓ | Full ✓ | Full (self-approve ⚠️) | Full ✓ | Full ✓ | Full ✓ |
| Staff (requireClerkUser) | Read ✓ | Read ✓ | — | — | Submit ✓ | Read ✓ | Read ✓ |
| Unauthenticated | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## 35. PHASE 34 — STATUS CONSISTENCY

| Entity | API/DB Status | Notes |
|---|---|---|
| bank_mutations | unmatched → matched → approved_pending_posting → posted → void | ✓ |
| bank_reconciliation_matches | candidate → approved → posted | ✓ |
| accounting_entries | draft → pending_approval → approved → posted → void | ✓ (enum: accounting_entry_status) |
| coa_change_requests | PENDING_APPROVAL → APPROVED / REJECTED | ✓ |
| expenses | draft → submitted → approved → paid / rejected | ✓ |
| bank_loans | — no data in dev env | — |

Status enum confirmed IMMUTABLE (ae_immutability trigger blocks field changes on posted entries).

---

## 36. PHASE 35 — NOTIFICATION & AUDIT TRAIL

| Table | Rows |
|---|---|
| bank_recon_audit_logs | 0 (dev env — no recon actions taken) |
| ledger_guard_audit | 0 (dev env) |
| journal_approval_logs | present (FK to accounting_entries) |
| ledger_events | 0 |
| audit_accounting_events | present |

Append-only triggers: `ae_immutability` confirmed on posted fields. `ae_insert_guard` blocks inserts without source.

---

## 37. PHASE 36 — RETRY, TIMEOUT & CONCURRENCY

| Check | Status |
|---|---|
| SELECT FOR UPDATE on approve | ✓ bankReconciliation.ts + unifiedMatchingEngine.ts |
| SELECT FOR UPDATE on post | ✓ bankReconciliation.ts |
| SELECT FOR UPDATE on match confirm | ✓ bankAllocationMatching.ts |
| Idempotency key on recon | ✓ lib/financial/idempotency.ts used by bankReconciliation.ts |
| Idempotency key on expense | ❌ Missing — R-2 |
| Idempotency key on loan | ❌ Missing — R-3 |
| Duplicate journal (tested) | 0 ✓ |
| Idempotency storage | `lib/financial/idempotency.ts` — in-memory + DB backed |

---

## 38. PHASE 37 — DATABASE CONSTRAINTS

| Check | Result |
|---|---|
| Foreign keys | 544 ✓ |
| Unique indexes | 960 ✓ |
| `idx_accounting_entries_source_source_id` | EXISTS — (source, source_id), no company_id ⚠️ |
| `idx_accounting_entries_co_src_srcid` | **ABSENT** ❌ R-1 |
| `accounting_entries_company_source_ref_uniq` | EXISTS ✓ |
| `accounting_entries_entry_number_unique` | EXISTS ✓ |
| `ae_insert_guard` trigger | ✓ blocks insert without source |
| `ae_period_lock_insert_guard` trigger | ✓ blocks insert into locked period |
| `ae_immutability` trigger | ✓ blocks update to financial fields on posted entries |

---

## 39. PHASE 38 — FRONTEND FLOW AUDIT

Not directly testable in agent context (no authenticated session). Architecture review:
- BizPortal routes: `pages/accounting/`, `pages/bank-reconciliation/`, `pages/treasury/`
- COA Proposals back button: added (navigates to /accounting/bank-reconciliation or /accounting)
- TypeScript: 0 new errors in api-server; BizPortal has pre-existing unbuilt lib issues

---

## 40. PHASE 39 — RUNTIME UAT

| Scenario | Runtime Evidence |
|---|---|
| 1. Import mutation | bank_mutations rows exist (7 total) ✓ |
| 2. Re-import same mutation | DUP_MUTATION_KEY=0 ✓ |
| 3. Existing journal + mutation | AE id=9 (bank_reconciliation, source_id=27125) ✓ |
| 4. Mutation first + manual review | match status=candidate (6 rows) ✓ |
| 5. Missing specific COA | fail-closed via COA proposal flow ✓ |
| 6. COA proposal | 129 approved, flow complete ✓ |
| 7. Rule recommendation | requiresHumanApproval=true ✓ |
| 8-10. Partial payment, internal transfer | No data in dev env |
| 11. Bank fee | AE id=13 (mutation 27124, Biaya Adm) ✓ |
| 12. Interest income + 20% tax | AE id=9 (Bunga 157,676) + id=12 (Pajak 31,535) ✓ |
| 13. Void journal | void_entry_id FK present ✓ |
| 14. Retry approve | SELECT FOR UPDATE guard ✓ |
| 15. Cross-company access | session.companyId enforced ✓ |

---

## 41. PHASE 40 — TEST & BUILD

| Check | Result |
|---|---|
| api-server full suite | **2660/2660 PASS (69 files)** ✓ |
| coa-tax-hierarchy.test.ts | 78/78 PASS ✓ |
| coa-governance.test.ts | 54/54 PASS ✓ |
| coa-migration-restart.test.ts | 28/28 PASS ✓ |
| bank-reconciliation.test.ts | PASS ✓ |
| sport-center-accounting suites | PASS ✓ |
| tenant-payment-accounting.test.ts | 12/12 PASS ✓ |
| ppjk-tenant-isolation.test.ts | 15/15 PASS ✓ |
| aiLearningCenter.test.ts | 7/7 PASS (pre-existing fix: .limit(500)) ✓ |
| api-server TypeScript | **0 errors** ✓ |
| api-server build | **Clean (16.7 MB)** ✓ |
| BizPortal TypeScript | ⚠️ ENVIRONMENT LIMITATION (unbuilt lib/api-client-react, lib/object-storage-web — pre-existing) |

---

## 42. FINDINGS SUMMARY

### Required Fixes

| ID | Severity | Finding | Impact |
|---|---|---|---|
| R-1 | HIGH | `idx_accounting_entries_co_src_srcid` ABSENT from runtime DB; only `idx_accounting_entries_source_source_id` (no company_id) active. Dedup does not enforce company isolation at DB level. | Same source+source_id in different companies would BLOCK INSERT (false rejection). Same source+source_id in same company not blocked at DB level (only app-layer check). |
| R-2 | MEDIUM | POST expense has no idempotency guard, no x-idempotency-key, expense+journal not atomic. Double-click/retry can create duplicate expense + duplicate journal. | Potential duplicate journals from concurrent requests |
| R-3 | MEDIUM | `bankLoans.ts`: journal created first, then loan insert — separate transactions. Journal error caught and logged but loan record can persist without GL link. | Loan record orphaned from General Ledger |

### Advisory Items

| ID | Severity | Finding |
|---|---|---|
| A-1 | MEDIUM | 3 bank mutations (27123, 27124, 27125) posted without bank_reconciliation_matches entry. Journals exist (AE ids 14, 13, 9). Legacy direct-post code path bypassed match record creation. |
| A-2 | MEDIUM | AE id=10 (SCPAY-5) posted with 0 accounting_entry_lines, source_id=NULL. 30,000 in column totals but no debit/credit lines. Causes total_debit direct-sum to be 30,000 higher than line-sum. |
| A-3 | LOW | Admin users can self-approve COA proposals (`isAdmin` exemption in coaProposalService.ts). Recommendation: require 4-eye principle for all COA changes regardless of role. |
| A-4 | LOW | `resolveCompany.ts` falls back to company_id=1 for admins without assigned company. A misconfigured admin can access company 1. |

---

## 43. RISKS

| Risk | Probability | Severity | Mitigation |
|---|---|---|---|
| Same source/source_id cross-company collision blocked by wrong index | LOW (no instances today) | HIGH | R-1 fix: correct index |
| Expense duplicate from network retry | MEDIUM (UI can fire twice) | MEDIUM | R-2 fix: idempotency |
| Loan without GL entry | LOW (no loans in dev env) | MEDIUM | R-3 fix: atomic tx |
| Admin self-approves COA unilaterally | LOW (trusted role) | MEDIUM | A-3 advisory |
| SCPAY-5 posted entry corrupts future Trial Balance aggregation | EXISTS now | MEDIUM | A-2: investigate and void if invalid |

---

## 44. REQUIRED FIXES

### R-1 — Core Accounting Dedup Index (HIGH)

**Root cause:** `accountingMigration.ts` creates `idx_accounting_entries_co_src_srcid` using `source::text <> 'manual'` in WHERE clause. The cast fails IMMUTABILITY check at startup, preventing index creation. Runtime DB only has the Sport Center–owned `idx_accounting_entries_source_source_id` (no company_id).

**Fix:**
```sql
CREATE UNIQUE INDEX IF NOT EXISTS accounting_entries_company_source_source_id_uniq
  ON accounting_entries (company_id, source, source_id)
  WHERE source IS NOT NULL
    AND source_id IS NOT NULL
    AND source <> 'manual'::accounting_entry_source;
```
- Use `source <> 'manual'::accounting_entry_source` (enum literal, not cast)
- Include company_id in uniqueness
- Idempotent (IF NOT EXISTS)
- No DROP of existing indexes

### R-2 — Expense Idempotency (MEDIUM)

**Root cause:** `expenses.ts` POST handler has no `x-idempotency-key` support. Expense insert and journal creation are in separate DB statements. A double-click creates two expense rows and potentially two journals.

**Fix:**
- Add `x-idempotency-key` header support using existing `lib/financial/idempotency.ts`
- Store idempotency result in persistent table (not in-memory only)
- Wrap expense insert + journal creation in single DB transaction
- Return existing result for duplicate key; HTTP 409 for same key + different payload

### R-3 — Loan Journal Atomicity (MEDIUM)

**Root cause:** `bankLoans.ts` creates journal first (line 134), then inserts loan (line 161) in separate statements. Journal errors are caught and logged but do not prevent loan commit.

**Fix:**
- Wrap loan insert + journal create in `db.transaction(async (tx) => { ... })`
- Pass `tx` client to journal creation helper
- If either step fails, rollback both
- Return typed errors: LOAN_JOURNAL_MAPPING_REQUIRED, LOAN_JOURNAL_CREATION_FAILED

---

## 45. ADVISORY

1. **A-1 (3 bypass mutations):** Audit the 2025-11-30 data load that created mutations 27123-27125 in posted state without match records. Consider adding a reconciliation cleanup to link them retroactively, or mark them as legacy and exclude from new match flow.

2. **A-2 (SCPAY-5 posted entry without lines):** Source_id=NULL suggests this entry was created by a code path that never saved the booking reference. The entry should be voided if it represents a real transaction that was double-posted elsewhere, or left as-is if it represents a compensating entry. Investigate whether a corresponding sport_center_booking record exists for source_id.

3. **A-3 (Admin self-approval):** Consider requiring `reviewed_by ≠ requested_by` for ALL users including admins for COA governance changes that affect the master COA. The current exemption creates a single-person risk for sensitive COA operations.

4. **A-4 (Company fallback for admins):** Add a startup validation check that all active admin accounts have `companyId` assigned to prevent accidental fallback to company 1.

---

## 46. FINAL VERDICT

| Module | Verdict |
|---|---|
| Bank Mutation Import | ✅ FLOW CORRECT |
| Deduplication | ⚠️ PARTIAL — company-scoped index absent (R-1) |
| Matching Engine | ✅ FLOW CORRECT |
| Approval State Machine | ⚠️ PARTIAL — 3 legacy bypass mutations (A-1) |
| Journal Creation | ⚠️ PARTIAL — 1 posted entry without lines (A-2) |
| Double Journal Protection | ⚠️ PARTIAL — app-layer only (R-1 index absent) |
| Posting & Ledger | ✅ FLOW CORRECT |
| Accounting Equation | ✅ FLOW CORRECT (debit=credit, orphan=0) |
| Tax COA Runtime | ✅ FLOW CORRECT |
| AI Transaction Intelligence | ✅ FLOW CORRECT |
| AI Learning | ✅ FLOW CORRECT |
| COA Proposal | ⚠️ PARTIAL — admin self-approval advisory (A-3) |
| COA Governance | ✅ FLOW CORRECT |
| Rule Engine | ✅ FLOW CORRECT |
| Expense Flow | ⚠️ PARTIAL — no idempotency (R-2) |
| Loan Flow | ⚠️ PARTIAL — non-atomic (R-3) |
| Treasury | ✅ FLOW CORRECT |
| Security & Auth | ✅ FLOW CORRECT |
| Company Isolation | ✅ FLOW CORRECT |
| Test Suite | ✅ 2660/2660 PASS |
| TypeScript | ✅ 0 errors |
| Build | ✅ Clean |

## 🟡 FLOW VERIFIED WITH ADVISORY

Runtime evidence: debit=credit=Rp561,146 (company 1), double journals=0, orphan lines=0, unbalanced=0, 2660/2660 tests PASS.  
3 required fixes remain open (R-1 HIGH, R-2 MEDIUM, R-3 MEDIUM).  
Proceeding to remediation per File 2.

---

*Generated: 2026-08-03 | Audit scope: 43 phases | Source: live Supabase dev DB + source code + test suite*
