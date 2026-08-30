---
name: QRIS H-1 candidate cohort
description: Production QRIS candidate generation must use exact settlement-date evidence for H-1.
---

The QRIS auto-match path treats H-1 as an exact cohort: a confirmed QRIS payment's Jakarta `paid_at` date plus one calendar day must equal the bank mutation date, and the bank amount must equal gross minus the payment MDR. Candidate discovery is positive-only; provider, account, metadata, and booking date are not gates.

**Why:** The new operational flow must auto-match only deterministic evidence and must not expose failed rows as REVIEW/UNMATCHED candidates. Legacy provider/account/settlement mirrors can be absent or stale, while booking dates are not settlement evidence.

**How to apply:** Generate only `confirmed` payments from `paid_at` with exact calendar H-1 and exact MDR net. Auto-match the bank row and keep journal/settlement approval separate. Do not fall back to pending status, booking date, or stale settlement metadata.