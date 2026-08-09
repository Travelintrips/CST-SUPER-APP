---
name: QRIS approval race guard
description: Invariant and error contract for concurrent QRIS settlement batch approval
---

QRIS settlement approval must lock all referenced Sport Center payments in a stable ascending-ID order before checking prior settlement, then insert settlement items under the database unique invariant on `sport_payment_id`. The pre-check alone is not sufficient under concurrent admin approvals.

**Why:** Two overlapping batch approvals can both observe no existing settlement before either transaction inserts its item. The database constraint is the authoritative winner selector; the losing approval must roll back and return HTTP 409 with an informative double-settlement error.

**How to apply:** Keep `uq_qris_settlement_items_payment` active in the runtime migration and map PostgreSQL `23505` for that constraint to `QRIS_PAYMENT_ALREADY_SETTLED`/409. Do not use `ON CONFLICT DO NOTHING`, because silently dropping an item would leave an apparently approved but incomplete settlement.