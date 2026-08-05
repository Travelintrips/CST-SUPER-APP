---
name: Advance repayment ref uniqueness
description: postRepaymentJournal refSuffix must be passed from the repay route; omitting it causes 2nd+ repayments to fail with a unique constraint violation.
---

## The Rule

Always pass `refSuffix` when calling `AdvanceJournalService.postRepaymentJournal()` from the `/api/advances/:id/repay` route. Count existing repayments first and use `String(count + 1)` as the suffix.

## Why

`postRepaymentJournal` generates `ref = RPY-{advanceNumber}` when no `refSuffix` is provided. On a second repayment, `ledgerGuard.ts` INSERTs the new entry as `draft` (succeeds — partial unique index only enforces uniqueness WHERE `status='posted'`), then tries to UPDATE it to `posted`. That UPDATE fails because a `posted` entry with the identical ref already exists from the first repayment.

This is the same partial-unique-index trap documented in `accounting-entries-ref-conflict.md`.

## How to Apply

In `artifacts/api-server/src/routes/advances.ts` `/api/advances/:id/repay` handler, before calling `postRepaymentJournal`:

```ts
const [{ count: existingRepaymentCount }] = await db.execute<any>(
  sql`SELECT COUNT(*)::int AS count FROM cash_advance_repayments WHERE advance_id = ${id}`
).then(r => r.rows);
// pass refSuffix = "1", "2", … so each repayment gets a unique journal ref
refSuffix: String(Number(existingRepaymentCount) + 1)
```

Resulting refs: `ADV-{number}-1`, `ADV-{number}-2`, … (unique per repayment, no `RPY-` prefix when refSuffix is supplied — that is acceptable).
