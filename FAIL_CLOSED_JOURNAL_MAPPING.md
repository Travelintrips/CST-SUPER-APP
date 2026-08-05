# Fail-Closed Journal Mapping — Design & Enforcement

## Overview

Task #6 establishes **fail-closed** semantics for all bank reconciliation journal mapping.
"Fail-closed" means: if a specific COA account cannot be resolved, **no journal is created**
and the approval is blocked with a `manual_review_required` signal rather than silently falling
back to a generic account (e.g. `5-2040`).

---

## Problem Addressed

Before Task #6, when the matching engine could not resolve a contra-account (AR / AP / expense COA),
it fell back to generic catch-all codes (`5-2040`, `1-1020`, `2-1020`). This produced:

- Journals posted to the wrong GL account
- Silent reconciliation with no signal to the accountant
- No audit trail for "I couldn't find the right account"

---

## Architecture

### Error Taxonomy — `JournalMappingError`

All mapping failures are represented by `JournalMappingError` (defined in
`artifacts/api-server/src/lib/journalMappingErrors.ts`).

| Code | Meaning |
|---|---|
| `COA_NOT_FOUND` | Bank/cash COA not configured in company bank account or Accounting Settings |
| `SPECIFIC_COA_REQUIRED` | A specific mapping is required but only a generic fallback exists |
| `JOURNAL_MAPPING_REQUIRED` | No mapping found at all — AR/AP/expense COA missing |
| `COA_NOT_POSTABLE` | COA exists but is not a postable leaf account |
| `COA_INACTIVE` | COA exists but has been deactivated |
| `COA_COMPANY_MISMATCH` | COA belongs to a different company |
| `COA_EFFECTIVE_DATE_INVALID` | COA not yet effective on the transaction date |
| `COA_HEADER_NOT_POSTABLE` | COA is a header/group account, cannot receive journal lines |
| `COA_MAPPING_AMBIGUOUS` | Multiple conflicting mappings found |

### Safe Error Contract

`JournalMappingError.toSafeResponse()` returns **only** three fields:

```json
{
  "error":                "<human-readable message>",
  "code":                 "<JournalMappingErrorCode>",
  "manual_review_required": true
}
```

The `context` object (used for internal logging) is **deliberately excluded** from the safe
response. It may contain SQL queries, file paths, table names, account codes, and other
implementation details that must never reach the client.

---

## Propagation Chain

```
resolveContraAccount()            ← returns null when no specific COA found
      ↓
approveAndCreateJournal()         ← throws JournalMappingError (not generic Error)
  inside db.transaction()         ← FULL ROLLBACK on any throw
      ↓
catch(e) block                    ← detects instanceof JournalMappingError
      ↓                              returns { ok:false, manual_review_required:true, code }
POST /:mutationId/approve route   ← checks result.manual_review_required
      ↓                              returns HTTP 422 (not 400)
Frontend approveMut.mutationFn    ← reads body before throwing
      ↓                              on 422+manual_review_required: returns as data
onSuccess handler                 ← sets manualReviewWarning state
      ↓
Approve dialog banner             ← shows warning, disables Approve button
```

---

## Atomicity Guarantee

All journal creation steps execute inside `db.transaction()`:

1. `SELECT FOR UPDATE` — row lock on `bank_mutations`
2. Guard: idempotency / existing approval check
3. Resolve bank COA + contra account + bank journal
4. `postEntryWithClient` — inserts journal header + lines
5. `UPDATE bank_mutations SET status = 'approved_pending_posting', journal_entry_id = ...`
6. `UPDATE / INSERT bank_reconciliation_matches`
7. `INSERT bank_reconciliation_audit`

If step 3 throws `JournalMappingError`, the entire transaction is rolled back:
- No journal header created
- No journal lines created
- `bank_mutations.status` unchanged
- `bank_mutations.journal_entry_id` remains `null`
- No audit record of a false approval

---

## Frontend Behaviour

When backend returns `{ manual_review_required: true, code, error }`:

1. Warning banner appears inside the Approve dialog
2. Banner shows: human-readable reason + error code
3. **Approve button is disabled** — user cannot retry until they configure the missing COA
4. Dialog can be closed; warning resets on next open
5. User action required: configure the specific COA in Accounting Settings, then re-approve

---

## Files Changed in Task #6

| File | Change |
|---|---|
| `src/lib/journalMappingErrors.ts` | Defines `JournalMappingError`, typed codes, `toSafeResponse()` |
| `src/lib/journalMappingValidator.ts` | Throws `JournalMappingError` for generic fallback codes |
| `src/lib/failClosedValidator.ts` | `validateJournalAccountOrThrow`, `requireSpecificCoaOrFail` |
| `src/lib/reconciliation/unifiedMatchingEngine.ts` | Throws `JournalMappingError` (not generic Error); catch propagates typed fields |
| `src/routes/bankReconciliation.ts` | Returns HTTP 422 + `manual_review_required` when result has mapping error |
| `artifacts/bizportal/src/pages/accounting/bank-reconciliation.tsx` | Handles 422 response, shows warning banner, disables Approve button |
| `src/__tests__/journal-mapping-fail-closed.test.ts` | Unit tests: error codes, safe response, atomicity, Phase 4 regressions |
