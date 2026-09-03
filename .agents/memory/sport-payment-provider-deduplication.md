---
name: Sport payment provider deduplication
description: Logical payment identity for recurring Sport Center booking groups
---

Recurring Sport Center bookings may persist one confirmed payment row per booking while reusing the same provider order and proof. Those rows represent one customer payment, not separate revenue.

**Why:** Counting each source row separately duplicates the payment list, revenue totals, and QRIS candidate supply; grouping only by note or amount is unsafe because notes may be missing on the first row.

**How to apply:** When reading canonical Sport Center payments for reviewer-facing lists, totals, or QRIS candidate generation, partition nonblank `provider_order_id` values and keep one deterministic representative. Preserve related booking identities for search/audit; rows with no provider order must remain separate.

Production can also contain multiple confirmed QRIS rows for one booking with different provider order IDs. Provider-only partitioning will intentionally keep both rows, so candidate generation must separately flag same-booking duplicate/overpayment evidence rather than summing it silently.

**Why:** A booking's total amount is a stronger duplicate signal than a provider order ID when a retry or second proof creates a new provider identity; otherwise one booking can inflate a settlement batch and force an otherwise exact bank match into review.

**How to apply:** Keep the source rows for audit, but make same-booking full-payment collisions ambiguous/non-approvable until an owner confirms which payment is valid. Prevent new duplicates at the payment-write boundary with an idempotency or explicit overpayment rule; do not delete historical rows automatically.