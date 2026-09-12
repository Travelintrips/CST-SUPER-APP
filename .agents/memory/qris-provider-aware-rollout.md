---
name: QRIS provider-aware rollout
description: Provider-aware QRIS reconciliation must remain an additive candidate/review layer until explicitly approved for final reconciliation.
---

Provider-aware QRIS matching is deliberately candidate/review-only. Provider identity must come from explicit provider evidence; `payment_method=QRIS` or receiving bank/account name alone never identifies Mandiri or Paylabs. Unknown providers and non-actual/synthetic mutations must not auto-match. Candidate matching is scoped by company, settlement bank account, provider, and snapshotted expected settlement date.

**Why:** A bank mutation is the only final evidence, while provider batches can be net of deductions and contain many payments. Guessing a provider or posting from a generated Sport Center mutation can create cross-provider matches and incorrect accounting.

**How to apply:** Keep `sport_payments` as the canonical payment source, preserve gross separately from observed deduction/net credit, calculate expected settlement with Asia/Jakarta business-day rules, persist deterministic candidate rows for audit, and route final action through the existing explicit approval mechanism.

Natural-batch matching must not use unrestricted amount-only subset-sum. Build the complete company/account/provider/date batch first; only partition it when an auditable settlement/batch/reference key is present on both mutation and payment. Otherwise use `REVIEW` with an ambiguity reason. Candidate reruns must preserve the stored snapshot rather than overwrite it.

**Why:** A valid MDR rate can occur for many arbitrary payment combinations, and a provider may send multiple settlements to the same company account on one date. Amount-only selection can therefore create false positives even when the fee rate looks correct.

**How to apply:** Treat negative observed deduction as non-match, keep unknown provider and missing bank-account dimensions review-only, record provider detection source and rule version, and enforce one mutation per candidate plus one payment per final settlement at the database layer. Never enable final reconciliation or accounting posting as part of candidate hardening.

Regression fixtures for provider-compatible deductions should keep bank credit below gross; otherwise the engine correctly enters its negative-deduction/ambiguous-gross review branch before tolerance evaluation.