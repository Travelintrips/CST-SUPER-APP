---
name: Sport payment posted amount correction
description: Correcting a posted Sport Center payment requires an additive accounting correction and a manual-review mirror state.
---

When a canonical Sport Center payment amount is wrong after its accounting journal is posted, keep the original payment journal immutable. Create a balanced additive correction for the difference, update the canonical source and public projection to the corrected amount, and mark the projection `manual_review` until the mismatch is reconciled.

**Why:** Posted accounting payment rows are write-once financial history, while QRIS candidates must use the corrected canonical amount. A raw source update alone leaves the mirror and ledger inconsistent.

**How to apply:** Lock and verify the payment-to-booking-to-mirror-to-journal identity, fail closed on settlement or amount drift, use the booking's DPP/PPN to build the correction lines, then regenerate only the affected QRIS candidate snapshot without approving settlement.