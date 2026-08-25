---
name: QRIS H-1 candidate cohort
description: Production QRIS candidate generation must use exact settlement-date evidence for H-1.
---

The production QRIS candidate path treats H-1 as an exact cohort: a payment's expected settlement date must equal the bank mutation date. A configurable business-day window remains valid only for legacy review-only callers and historical partial-settlement analysis.

**Why:** A broad review window can display payments from the next day as candidates for the current bank mutation, which makes the candidate list violate the operating H-1 rule.

**How to apply:** Keep strict metadata-enabled generation fail-closed and exact-date; do not remove the legacy window without updating partial-settlement review semantics.