---
name: QRIS audit rate precision
description: Why the persisted observed deduction rate must not use a narrow bounded numeric type.
---

`effective_deduction_rate` is audit evidence derived from a bank credit and a candidate payment batch, not a validated provider fee percentage. It must be stored in an unconstrained numeric column so extreme unmatched or review-only evidence can be retained.

**Why:** A small natural batch against a much larger incoming bank credit can legitimately produce a negative effective rate below -10. The prior `NUMERIC(9,8)` type rejected those rows with numeric overflow and prevented the whole QRIS audit batch from being saved.

**How to apply:** Keep the candidate review-only when the observed rate is outside the configured provider tolerance. Do not clamp the rate, convert it to a matching rate, or use this evidence to approve/post a settlement. Any compatibility migration must widen pre-existing bounded columns as well as new-table definitions.