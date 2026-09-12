# R-3 — Loan Journal Atomicity

## Summary
Enforced **fail-closed atomicity** for bank loan creation and payment: the loan/payment record is only inserted into the database **after** the corresponding GL journal entry has been successfully created. If journal creation fails, no loan record exists — no orphaned loans without GL entries.

## Problem (before R-3)
The previous flow:
```
1. Validate COA mapping          OK
2. INSERT into bank_loans        ← loan record saved
3. POST journal entry            ← if this fails...
                                    loan record exists, journal does NOT
                                    → orphan loan without accounting
```

This created silent accounting gaps: loans appeared in the balance sheet but had no corresponding debit/credit entries.

## Fix

### Loan creation (`POST /api/bank-loans`)
```typescript
// ── Validate COA mapping — fail early before any DB writes ─────────────
if (!coaRow) {
  return res.status(422).json({ error: "LOAN_JOURNAL_MAPPING_REQUIRED", ... });
}

try {
  // ── Create journal FIRST ────────────────────────────────────────────
  const je = await postEntry({ ... });
  const journalEntryId = je.id;

  // ── Insert loan — only reached if journal succeeded ─────────────────
  const result = await db.execute(sql.raw(`
    INSERT INTO bank_loans (..., journal_entry_id) VALUES (..., ${journalEntryId})
  `));

  return res.status(201).json(result.rows[0]);

} catch (err) {
  // Journal failed or loan insert failed — no loan record persisted
  return res.status(503).json({ error: "LOAN_JOURNAL_CREATION_FAILED", ... });
}
```

### Payment route (`POST /api/bank-loans/:id/pay`)
Same pattern applied: journal is posted before `INSERT INTO bank_loan_payments`.

### Error codes
| Code | HTTP | Meaning |
|---|---|---|
| `LOAN_JOURNAL_MAPPING_REQUIRED` | 422 | COA accounts not configured for this loan type |
| `LOAN_JOURNAL_CREATION_FAILED` | 503 | Journal or DB write failed; client should retry |

## Test coverage
`artifacts/api-server/src/__tests__/r3-loan-atomicity.test.ts`

| Test | Verifies |
|---|---|
| 1 | No orphan loans (journal_entry_id IS NULL) in dev DB |
| 2 | Loan count baseline + journal linkage ratio |
| 3 | Debit-credit balance remains ≤ 0.01 across all posted entries |
| 4 | Route requires authentication (`requireAdmin`) |
| 5 | Loan insert is inside the `try` block (after journal creation) |
| 6 | Payment route also guards with `LOAN_JOURNAL_CREATION_FAILED` |

## Invariant
> **Every `bank_loans` row with `status NOT IN ('draft', 'cancelled')` must have `journal_entry_id IS NOT NULL`.**

This invariant is enforced at the application layer. A DB-level `CHECK` constraint can be added as a future hardening step.
