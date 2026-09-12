---
name: accounting_entries partial unique ref conflict
description: Partial unique constraint on accounting_entries causes draft→posted UPDATE to fail when ref is reused across test runs.
---

## The Rule

Test scripts that POST to `/api/accounting/bank-disbursements` (or any route calling `postEntry`) MUST use a unique `ref` value per run (e.g., append `Date.now().toString(36)` as `RUN_ID`).

**Why:** There is a partial unique index `accounting_entries_company_source_ref_uniq` on `(company_id, source, ref) WHERE status = 'posted'`. When `postEntry` inserts a new entry:
1. INSERT with `status = 'draft'` succeeds (draft entries are NOT in the partial index).
2. UPDATE `SET status = 'posted'` fails with `23505 duplicate key` if another entry with the same `(company_id, source, ref)` is already posted.

The Drizzle INSERT uses `onConflictDoNothing`, so the INSERT silently passes if the full (non-partial) unique constraint fires; but for the partial index scenario the INSERT succeeds and the UPDATE is what fails — making it look like a trigger error.

**How to apply:** In any verification/test script, declare a run-unique prefix:
```javascript
const RUN_ID = Date.now().toString(36).toUpperCase();
// Use in all ref fields:
ref: `TEST-T01-${RUN_ID}`,
```

This applies to `artifacts/api-server/tests/bank-disbursement-phase1.test.mjs` and any future test scripts that write journal entries.
