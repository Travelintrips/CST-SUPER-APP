---
name: Payment accounting outbox gap
description: Sport Center payment_confirmed events can fail before public mirror and settlement cohort creation.
---

A canonical Sport Center payment can have a payment_confirmed accounting journal and canonical payment row while its public mirror and settlement cohort are absent when `payment_accounting_outbox` is failed with `PAYMENT_ACCOUNTING_INCOMPLETE`.

**Why:** This creates a journal-backed payment that is visible to accounting evidence but omitted from prior public-mirror or settlement-based traces.

**How to apply:** When a payment_confirmed journal is missing from a settlement trace, inspect the canonical `payment_id` bridge, public mirror by `source_payment_id`, settlement items, and the payment accounting outbox before concluding the payment does not exist. A retained failed outbox row is recovered only when the canonical posted payment_confirmed journal exists; retain the row as evidence, classify it as recovered, and never replay it through a generic posting path.