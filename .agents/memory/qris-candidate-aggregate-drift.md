---
name: QRIS candidate aggregate drift
description: Persisted QRIS candidate totals may diverge from its payment-item snapshot and current source rows.
---

Before QRIS remediation, compare the candidate aggregate fields with the sum of `payment_items` and the live payment source. A candidate can keep the correct payment IDs while retaining stale gross, MDR, or net totals; only a dry-run regeneration that proves exact gross-minus-MDR equality is safe evidence for the replacement snapshot.

**Why:** A production candidate retained an incorrect aggregate total even though its payment-item membership and current source amounts produced the exact bank net during candidate-only regeneration.

**How to apply:** Treat aggregate mismatch as stale evidence, not as permission to edit payment or journal amounts. Regenerate through the guarded candidate-only path, verify `persisted`/status and exact bank equality, then leave approval and posting to the separate governed workflow.