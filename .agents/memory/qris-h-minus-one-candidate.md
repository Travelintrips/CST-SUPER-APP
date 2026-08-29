---
name: QRIS H-1 candidate cohort
description: Production QRIS candidate generation must use exact settlement-date evidence for H-1.
---

The QRIS candidate path treats H-1 as an exact cohort: a paid QRIS payment's Jakarta payment date plus one calendar day must equal the bank mutation date. Candidate discovery intentionally uses only `payment_method=QRIS`, payment date H-1, and company scope; provider, account, metadata, amount, and rate checks remain approval/review concerns. The booking date is not settlement evidence.

**Why:** The business review workflow needs to surface QRIS payments like the bank evidence even when legacy provider/account/settlement mirrors are incomplete or stale. A broad date window still displays payments from the wrong day, while booking dates and stale metadata are not settlement evidence.

**How to apply:** Generate review candidates from `paidAt`/payment time with exact H-1 date and preserve final approval safeguards. Never filter QRIS settlement by booking date or require stored expected settlement metadata merely to display a candidate.