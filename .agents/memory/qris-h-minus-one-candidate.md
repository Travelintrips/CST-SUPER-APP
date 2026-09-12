---
name: QRIS H-1 candidate cohort
description: Production QRIS candidate generation must use exact settlement-date evidence for H-1.
---

The QRIS auto-match path treats H-1 as an exact cohort: a confirmed QRIS payment's Jakarta `paid_at` date plus one calendar day must equal the bank mutation date, and the bank amount must equal gross minus the payment MDR. Candidate discovery is positive-only; provider, account, metadata, and booking date are not gates.

**Why:** The new operational flow must auto-match only deterministic evidence and must not expose failed rows as REVIEW/UNMATCHED candidates. Legacy provider/account/settlement mirrors can be absent or stale, while booking dates are not settlement evidence.

**How to apply:** Generate only `confirmed` payments from `paid_at` with exact calendar H-1 and exact MDR net. Auto-match the bank row and keep journal/settlement approval separate. Do not fall back to pending status, booking date, or stale settlement metadata.

Production candidate visibility also requires the corresponding `public.bank_mutations` row to exist on the exact H+1 date. Publishing code does not import, clone, or regenerate production bank data.

**Why:** Confirmed payments can be valid H-1 while the production mutation feed is stale; without the bank row there is no candidate identity or amount to match.

**How to apply:** Before debugging provider/MDR logic, compare the latest production mutation date with the payment's expected settlement date. Sync/import mutations, wait for matching to finish, then explicitly generate QRIS candidates.

Legacy posted settlement snapshots can combine H-1 payments with a later-dated payment and still produce an exact bank total; they are not strict QRIS evidence.

**Why:** A historical canonical settlement can look numerically ready while failing the current `paid_at` H-1 contract during approval, creating a misleading ready label and a guaranteed approval error.

**How to apply:** Never expose legacy `qris_settlement` links as QRIS approval or override actions. Require a current strict candidate whose live canonical payments pass `paid_at`, confirmed status, H-1, and exact MDR checks.