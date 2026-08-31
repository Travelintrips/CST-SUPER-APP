---
name: Sport payment provider deduplication
description: Logical payment identity for recurring Sport Center booking groups
---

Recurring Sport Center bookings may persist one confirmed payment row per booking while reusing the same provider order and proof. Those rows represent one customer payment, not separate revenue.

**Why:** Counting each source row separately duplicates the payment list, revenue totals, and QRIS candidate supply; grouping only by note or amount is unsafe because notes may be missing on the first row.

**How to apply:** When reading canonical Sport Center payments for reviewer-facing lists, totals, or QRIS candidate generation, partition nonblank `provider_order_id` values and keep one deterministic representative. Preserve related booking identities for search/audit; rows with no provider order must remain separate.