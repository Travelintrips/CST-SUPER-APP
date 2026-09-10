---
name: Marketplace deal price concurrency
description: Concurrency and timestamp precision rules for marketplace negotiated-price updates.
---

The deal-price write must lock the quote row, compare the caller's millisecond-visible timestamp after acquiring the lock, update the quote header before its lines, and require the guarded update to return a row. Generate the next timestamp monotonically from the locked row's visible timestamp so PostgreSQL timestamp precision cannot turn a valid update into a false stale rejection.

**Why:** PostgreSQL can retain timestamp precision that is not preserved by the API's JavaScript `Date` representation. Using the selected timestamp directly in a SQL equality predicate falsely rejected valid writes; ignoring the update result allowed stale requests to look successful.

**How to apply:** Preserve the lock/check/update ordering for any future deal-price revision, and verify both the stale response and absence of partial line writes under concurrent DEV proof.