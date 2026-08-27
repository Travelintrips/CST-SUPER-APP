---
name: QRIS H-1 candidate cohort
description: Production QRIS candidate generation must use exact settlement-date evidence for H-1.
---

The production QRIS candidate path treats H-1 as an exact cohort: a payment's expected settlement date must equal the bank mutation date. When a payment timestamp exists, derive that date from the payment timestamp and the active QRIS provider rule (normally H+1 calendar), rather than trusting stale mirrored metadata. The booking date is not settlement evidence. A configurable business-day window remains valid only for legacy review-only callers and historical partial-settlement analysis.

**Why:** A broad review window can display payments from the next day as candidates for the current bank mutation, while legacy mirrors can retain an incorrect settlement date after their underlying payment time is known. Both make the candidate list violate the operating H-1 rule.

**How to apply:** Keep strict metadata-enabled generation fail-closed and exact-date; compute from `paidAt`/payment time before falling back to a stored date; never filter QRIS settlement by booking date. Do not remove the legacy window without updating partial-settlement review semantics.