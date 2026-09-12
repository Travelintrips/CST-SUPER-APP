---
name: QRIS journal gross mismatch
description: Canonical QRIS approval can reject an exact bank net when live payment amount and payment journal gross diverge.
---

Before approving a QRIS settlement, compare each selected `sport_payments.amount` with the gross amount used by its payment journal. The candidate UI and initial bank check use live payment amounts, while the canonical settlement builder may calculate gross from locked payment journals; a legacy journal can therefore produce a misleading "net amount mismatch" even when the candidate snapshot and MDR calculation exactly match the bank.

**Why:** A PROD candidate had live gross 960,000 but its posted payment journal gross was 1,200,000; the second payment matched. The UI calculated 1,260,000 − 8,820 = 1,251,180 correctly, while the builder calculated from 1,500,000 and rejected the bank net.

**How to apply:** Fail with an explicit source-gross mismatch before the generic net error, and repair/reverse the stale journal or correct the live payment only after the underlying payment evidence is verified. Posted-journal guards and the existing amount-correction flow intentionally block direct mutation when source/mirror/journal identities already drift; use an additive correction owner that updates both canonical settlement consumption and the public ledger. Never override the bank amount.