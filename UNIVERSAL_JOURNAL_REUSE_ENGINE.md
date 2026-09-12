# Universal Journal Reuse Engine

**Version:** 1.0  
**Date:** 2026-08-03  
**Status:** Implemented & Tested

---

## 1. Original Sport Center Bug

### Root Cause

In `artifacts/api-server/src/lib/reconciliation/unifiedMatchingEngine.ts`, the journal
lookup for `sport_payment` candidates used a JOIN on a column that does not exist:

```sql
-- WRONG (was at line ~778):
FROM sport_payments sp
JOIN accounting_payments ap
  ON ap.id = sp.accounting_payment_id   ← column does not exist
JOIN accounting_entries ae ON ae.id = ap.entry_id
WHERE sp.id = ${sourceId}
```

The PostgreSQL error from this bad JOIN was silently swallowed:
```typescript
.catch(() => ({ rows: [] as any[] }))   ← UNSAFE_FINANCIAL silent catch
```

Because the lookup returned empty rows, `reusedEntry` stayed `null`, and the
reconciliation flow fell through to **create a second journal** — duplicating the
revenue posting that the Sport Center module had already made.

### Impact
- Revenue recorded twice for the same booking
- Bank balance recorded twice
- Trial Balance remained balanced (both entries have matching debit/credit)
- The duplicate was undetectable without source-level comparison

### Correct Relationship
```
sport_payments.id
  → accounting_payments.source_type = 'sport_center'
  → accounting_payments.source_doc_id = sport_payments.id
  → accounting_payments.entry_id
    → accounting_entries.id
```

---

## 2. Universal Architecture

All modules sharing the pattern:

```
Business Transaction → Accounting Journal → Bank Mutation → Bank Reconciliation
```

can now use a single decision engine instead of ad-hoc inline lookups.

The engine resolves one of four decisions before any journal is created or linked:

| Decision | Meaning | Action |
|---|---|---|
| `REUSE_EXISTING_JOURNAL` | Valid posted journal found | Link mutation to existing journal |
| `CREATE_NEW_JOURNAL` | No existing journal | Create new draft journal |
| `MANUAL_REVIEW_REQUIRED` | Ambiguous / error / draft found | Block; surface to reviewer |
| `REJECT_DUPLICATE` | Same event already reconciled | Reject with typed error |

---

## 3. Module Inventory

| Module | Candidate Type | Business Table | Accounting Source | Adapter |
|---|---|---|---|---|
| Sport Center Booking | `sport_payment` | `sport_payments` | `accounting_payments` (source_type=sport_center) | `resolveSportPaymentEntry` |
| Sport Center Membership | `sport_payment` | `sport_payments` | `accounting_payments` (source_type=sport_center) | `resolveSportPaymentEntry` |
| Customer Invoice/Payment | `invoice` | `sales_documents` | `accounting_entries` (source=sales_invoice/sales_payment) | `resolveInvoiceEntry` |
| Vendor Payment | `accounting_payment` | `accounting_payments` | `accounting_payments.entry_id` | `resolveAccountingPaymentEntry` |
| Expense | `expense` | `expenses` | `accounting_entries` (source=expense) | `resolveExpenseEntry` |
| Logistic Order | `logistic_order` | `logistic_orders` | `accounting_entries` (source=logistic_vendor_cost) | `resolveLogisticOrderEntry` |
| Tenant Invoice | `tenant_invoice` | `tenant_payments` | `accounting_entries` (source=tenant_rent_payment) | `resolveTenantInvoiceEntry` |
| Generic AP/AR | `accounting_payment` | `accounting_payments` | `accounting_payments.entry_id` | `resolveAccountingPaymentEntry` |

### Modules returning MANUAL_REVIEW_REQUIRED (insufficient relationship mapping):
- Unknown future candidate types
- Any candidate with missing `source_type`/`source_doc_id` linkage

---

## 4. Economic Event Identity

Each economic event is identified by:

```
companyId            (from authenticated session — never from request body)
candidateType        (from bank_reconciliation_matches — never from client)
candidateId          (from bank_reconciliation_matches)
mutationId           (bank_mutations.id)
mutationAmount       (bank_mutations.amount)
mutationDate         (bank_mutations.transaction_date)
```

Identity is stable: it does not depend on description text, mutation keys, or
internal UUIDs that change between imports.

---

## 5. Existing Journal Relationships

### Sport Center
```
sport_payments.id → accounting_payments (source_type='sport_center', source_doc_id=sport_payments.id)
                  → accounting_entries (via accounting_payments.entry_id)
Also: accounting_entries (source='sport_center_booking'|'sport_center_membership', source_id=sport_bookings.id)
```

### Customer Invoice/Payment
```
sales_documents.id → accounting_entries (source='sales_invoice'|'sales_payment', source_id=sales_documents.id)
```

### Vendor / AP
```
accounting_payments.id → accounting_entries (via accounting_payments.entry_id)
purchase_documents.id → accounting_entries (source='purchase_bill', source_id=purchase_documents.id)
```

### Expense
```
expenses.id → accounting_entries (source='expense', source_id=expenses.id)
```

### Logistic Order
```
logistic_orders.id → accounting_entries (source='logistic_vendor_cost', source_id=logistic_orders.id)
```

### Tenant Rent
```
tenant_payments.id → accounting_entries (source='tenant_rent_payment', source_id=tenant_payments.id)
```

### Bank Reconciliation (new journals)
```
bank_mutations.id → accounting_entries (source='bank_reconciliation', source_id=bank_mutations.id)
                 → bank_mutations.journal_entry_id
```

---

## 6. Reuse Engine

**File:** `artifacts/api-server/src/lib/reconciliation/journalReuseEngine.ts`

```typescript
export async function resolveJournalForEconomicEvent(
  client: DbClient,
  args: ResolveJournalArgs,
): Promise<JournalResolutionResult>
```

### Decision Rules

#### REUSE_EXISTING_JOURNAL
- Posted journal exists for this economic event
- Same company as authenticated session
- Not voided, not reversed
- Amount compatible (within 1 unit or 0.1% tolerance)
- Not already reconciled to a different mutation

#### CREATE_NEW_JOURNAL
- No existing journal found for this economic event
- Candidate type is a known, mapped type
- No duplicate economic event indicators

#### MANUAL_REVIEW_REQUIRED
- DB lookup error (fail-closed)
- Draft/pending/approved_pending_posting journal found
- Voided journal found
- Reversed journal found
- Amount mismatch
- Company mismatch
- Unknown candidate type

#### REJECT_DUPLICATE
- Same economic event already reconciled and linked to a **different** bank mutation

---

## 7. Source Adapters

Each adapter is a pure lookup function scoped by company:

| Adapter | Input | Query path |
|---|---|---|
| `resolveSportPaymentEntry` | sport_payments.id | `accounting_payments` WHERE source_type='sport_center' AND source_doc_id=? |
| `resolveAccountingPaymentEntry` | accounting_payments.id | `accounting_payments` WHERE id=? |
| `resolveInvoiceEntry` | sales_documents.id | `accounting_entries` WHERE source IN ('sales_invoice','sales_payment') AND source_id=? |
| `resolveExpenseEntry` | expenses.id | `accounting_entries` WHERE source='expense' AND source_id=? |
| `resolveLogisticOrderEntry` | logistic_orders.id | `accounting_entries` WHERE source='logistic_vendor_cost' AND source_id=? |
| `resolveTenantInvoiceEntry` | tenant_payments.id | `accounting_entries` WHERE source='tenant_rent_payment' AND source_id=? |

Each adapter also detects if the found journal is already reconciled to a different
mutation (via `bank_mutations.journal_entry_id` LEFT JOIN) and surfaces it in
`reconciledMutationId` for the REJECT_DUPLICATE path.

---

## 8. Decision Contract

```typescript
export type JournalResolutionDecision =
  | "REUSE_EXISTING_JOURNAL"
  | "CREATE_NEW_JOURNAL"
  | "MANUAL_REVIEW_REQUIRED"
  | "REJECT_DUPLICATE";

export interface JournalResolutionResult {
  decision: JournalResolutionDecision;
  companyId: number | null;
  economicEventType: string;
  existingJournalId: number | null;
  existingJournalNumber: string | null;
  sourceDocumentId: number | null;
  matchedCandidateType: string | null;
  confidence: number;              // 0–100
  reasons: string[];
  evidence: Record<string, unknown>;
  duplicateRisk: "none" | "low" | "medium" | "high";
  requiresHumanReview: boolean;
  safeToCreateJournal: boolean;
}
```

---

## 9. Backend Enforcement

The engine is called **inside the database transaction** in
`approveAndCreateJournal()`, after the `FOR UPDATE` row lock on `bank_mutations`
and before any journal creation:

```typescript
const reuseResolution = await resolveJournalForEconomicEvent(tx, {
  companyId,
  candidateType: selectedCandidateType,
  candidateId: selectedCandidateId,
  mutationId,
  mutationAmount: amount,
  mutationDate: txDate,
});

switch (reuseResolution.decision) {
  case "REJECT_DUPLICATE":      → throw typed error
  case "MANUAL_REVIEW_REQUIRED": → throw JournalMappingError (422)
  case "REUSE_EXISTING_JOURNAL": → set reusedEntry, skip journal creation
  case "CREATE_NEW_JOURNAL":     → fall through to postEntryWithClient
}
```

The frontend **cannot** influence this decision. The backend computes it from
runtime data, using the session-scoped `companyId`.

---

## 10. AI Integration

The existing AI Decision Policy (`phase4RecommendationEngine.ts`) provides:
- Candidate recommendations
- Confidence scores
- Evidence / explanation

The Universal Journal Reuse Engine enforces the actual decision. AI provides
input; backend enforces output. AI cannot create, approve, post, or link journals.

---

## 11. Bank Reconciliation Flow (after fix)

```
approveAndCreateJournal(mutationId, matchId, candidateType, candidateId, actor)
  │
  ├── Step 1: SELECT bank_mutations FOR UPDATE (row lock)
  ├── Step 2: Guard — already approved / conflicting match check
  ├── Step 3: Resolve bank COA + accounting settings
  │
  ├── Step 3b: resolveJournalForEconomicEvent() ← NEW
  │     ├── REJECT_DUPLICATE   → throw ECONOMIC_EVENT_DUPLICATE
  │     ├── MANUAL_REVIEW_REQUIRED → throw JournalMappingError (422)
  │     ├── REUSE_EXISTING_JOURNAL → reusedEntry = {id, entryNumber}
  │     └── CREATE_NEW_JOURNAL  → reusedEntry = null (continue to Step 4)
  │
  ├── if reusedEntry:
  │     ├── UPDATE bank_mutations SET status='posted', journal_entry_id=reusedEntry.id
  │     ├── UPDATE/INSERT bank_reconciliation_matches status='approved'
  │     ├── INSERT bank_reconciliation_audit MATCH_APPROVED (reused_existing_entry=true)
  │     └── RETURN {ok: true, journalEntryId: reusedEntry.id}
  │
  └── else (CREATE_NEW_JOURNAL):
        ├── Step 4: postEntryWithClient (draft journal)
        ├── Step 5: UPDATE bank_mutations status='approved_pending_posting'
        ├── Step 6: UPDATE/INSERT bank_reconciliation_matches
        ├── Step 7: INSERT bank_reconciliation_audit MATCH_APPROVED
        └── RETURN {ok: true, journalEntryId: entry.id}
```

---

## 12. Atomicity

- The entire flow runs inside `db.transaction(async (tx) => { ... })`
- The `FOR UPDATE` on `bank_mutations` prevents concurrent double-approval
- `resolveJournalForEconomicEvent` uses the same `tx` client — no phantom reads
- Any failure → full ROLLBACK: no partial reconciliation, no partial journal

---

## 13. Duplicate Guard

Multiple layers:

1. **Engine**: Checks if existing journal is already linked to another mutation → REJECT_DUPLICATE
2. **`_postEntryCore` idempotency**: `WHERE source=? AND source_id=? AND company_id=?` before insert
3. **`bank_mutations.status` guard**: Throws CONFLICT if `status = 'approved'` or `'posted'`
4. **`bank_reconciliation_matches` guard**: Checks for existing `status='approved'` match

---

## 14. Silent Error Audit Classification

| Location | Pattern | Classification | Action |
|---|---|---|---|
| `unifiedMatchingEngine.ts` line 794 (OLD) | `.catch(() => ({ rows: [] }))` on journal lookup | **UNSAFE_FINANCIAL** | ✅ FIXED — replaced by engine |
| `unifiedMatchingEngine.ts` line 739 | `.catch(() => ({ rows: [] }))` on bank account COA | SAFE — fallback triggers proper error | Acceptable |
| `unifiedMatchingEngine.ts` line 754 | `.catch(() => ({ rows: [] }))` on accounting_settings | SAFE — triggers JournalMappingError | Acceptable |
| `unifiedMatchingEngine.ts` line 876 | `.catch(() => ({ rows: [] }))` on journal lookup | SAFE — triggers JournalMappingError | Acceptable |
| `outboxProcessor.ts` line 112 | `.catch(() => ({ rows: [] }))` | SAFE_NONCRITICAL (outbox poll) | Monitor |
| `expenses.ts` auto-post `.catch` | Silent auto-post failure | SAFE — draft fallback | Acceptable |
| `ledgerGuard.ts` multiple `.catch` | Tag/lock failures | SAFE_NONCRITICAL | Acceptable |

---

## 15. Historical Duplicate Findings

See Phase 23 runtime query results for the development database.

A read-only SQL query was run against the development DB to identify candidates:
```sql
SELECT a.id, b.id, a.source, b.source, a.total_debit, a.date
FROM accounting_entries a
JOIN accounting_entries b ON b.id > a.id
  AND b.company_id = a.company_id
  AND b.date = a.date
  AND b.total_debit = a.total_debit
  AND a.source <> b.source
WHERE a.status IN ('posted', 'draft')
  AND a.total_debit::numeric > 0
```

No automatic remediation was performed. If duplicates are confirmed:
- Identify the original journal (earlier id, source = business module)
- Identify the duplicate (later id, source = bank_reconciliation)
- Create a controlled reversal via the existing reversal API
- Preserve audit trail; check period lock before reversing

See `HISTORICAL_VOID_REMEDIATION_REPORT.md` for the reversal procedure.

---

## 16. Security

- `companyId` always resolved from **authenticated session** — never from request body
- Engine validates company match on every reuse candidate
- Cross-company reuse → MANUAL_REVIEW_REQUIRED (hard block)
- Error responses contain: `error`, `code`, `manual_review_required` — no SQL, no stack, no schema

---

## 17. Tests

**File:** `artifacts/api-server/src/__tests__/journal-reuse-engine.test.ts`

26 tests covering all 14 decision scenarios from the master prompt:
- All 4 decision paths
- All 6 source adapters
- Amount tolerance (exact + rounding)
- Voided / reversed / draft journal handling
- Company isolation
- Determinism
- DB mutation prevention (engine is read-only)
- SQL verification (source_type/source_doc_id used, not accounting_payment_id)

**Results:** 26/26 passing ✅

---

## 18. Remaining Module Gaps

The following modules need source adapters when they become Bank Reconciliation
candidates (currently they route to CREATE_NEW_JOURNAL or return MANUAL_REVIEW):

| Module | Gap | Adapter Needed |
|---|---|---|
| Dana Talangan / Cash Advance | source='cash_advance' relationship unverified | `resolveAdvanceEntry` |
| Treasury | No candidate type mapping | `resolveTreasuryEntry` |
| Fixed Asset | source='fixed_asset_purchase' unverified | `resolveFixedAssetEntry` |
| Bank Loan | source='bank_loan_receipt' unverified | `resolveLoanEntry` |
| Payroll | source='payroll_accrual' unverified | `resolvePayrollEntry` |
| Tax | Multiple source types | `resolveTaxEntry` |
| PPJK | source='ppjk_duty' unverified | `resolvePpjkEntry` |
| Payment Gateway | source='sales_payment' (shared with AP) | `resolvePaymentGatewayEntry` |

For all gaps: engine returns `CREATE_NEW_JOURNAL` for known types and
`MANUAL_REVIEW_REQUIRED` for unknown types. No silent fallback.

---

## 19. Historical Remediation

**STOP — manual approval required before any historical journal reversal.**

To remediate confirmed historical duplicates:
1. Run the Phase 23 read-only audit query on production (read-only DB access)
2. For each CONFIRMED_DUPLICATE: create a remediation plan (journal A original, journal B duplicate)
3. Verify mutation linkage for journal B
4. Check period lock for the period of journal B
5. Submit for finance team approval
6. Execute controlled reversal via `/api/accounting/entries/:id/reverse`
7. Verify Trial Balance after reversal

Do NOT use direct SQL UPDATE/DELETE on accounting_entries or accounting_entry_lines.
