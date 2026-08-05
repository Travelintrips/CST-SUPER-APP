# Sport Center Double Posting — Fix Report

**Date:** 2026-08-03  
**Status:** Fixed & Tested

---

## Root Cause

`unifiedMatchingEngine.ts` contained a JOIN on a column that does not exist:

```typescript
// BEFORE (broken — line ~778):
const sourceQuery = `
  SELECT ae.id, ae.entry_number
  FROM sport_payments sp
  JOIN accounting_payments ap
    ON ap.id = sp.accounting_payment_id   ← COLUMN DOES NOT EXIST
  JOIN accounting_entries ae ON ae.id = ap.entry_id
  WHERE sp.id = ${sourceId} AND ae.status = 'posted'
    AND ae.company_id = ${companyId}
  LIMIT 1
`;
const { rows: sourceRows } = await tx.execute(sql.raw(sourceQuery))
  .catch(() => ({ rows: [] as any[] }));         ← SILENT CATCH swallowed the error
// → rows always empty → reusedEntry = null → CREATE second journal
```

## Financial Impact

- Revenue recorded twice for each Sport Center booking reconciled via Bank Recon
- Bank balance debited twice  
- Trial Balance remained balanced (both entries are balanced double-entries)
- Undetectable without cross-source journal comparison

## Correct Relationship

```
sport_payments.id (candidate_id in bank_reconciliation_matches)
  ↓
accounting_payments WHERE source_type = 'sport_center'
                       AND source_doc_id = sport_payments.id
  ↓
accounting_payments.entry_id
  ↓
accounting_entries.id (the posted journal to reuse)
```

## Fix Applied

Replaced the entire inline lookup block with a call to the Universal Journal
Reuse Engine (`resolveJournalForEconomicEvent`), which:

1. Uses the **correct** `accounting_payments.source_type / source_doc_id` relationship
2. **Fails closed** on any DB error (→ MANUAL_REVIEW_REQUIRED, never silent empty)
3. Validates company scope, journal status, amount compatibility
4. Handles ALL candidate types, not just sport_payment and accounting_payment

## Dev DB Audit (Phase 23)

A read-only scan of the development database found **0 duplicate journal candidates**
for sport center bookings. The historical Rp30.000 duplicate described in the
background is not present in the current dev database.

If present in production: execute a controlled reversal of the duplicate
`source='bank_reconciliation'` entry after finance team approval, while preserving
the original `source='sport_center_booking'` entry.

## Tests

- 26 new Universal Journal Reuse Engine tests — all passing
- Includes specific test verifying `source_type`/`source_doc_id` is used (not `accounting_payment_id`)
- 272 total tests across 9 test files — all passing
