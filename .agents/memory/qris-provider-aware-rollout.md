---
name: QRIS provider-aware rollout
description: Provider-aware QRIS reconciliation must remain an additive candidate/review layer until explicitly approved for final reconciliation.
---

Provider-aware QRIS matching is deliberately candidate/review-only. Provider identity must come from explicit provider evidence; `payment_method=QRIS` alone never identifies Mandiri or Paylabs. Unknown providers and non-actual/synthetic mutations must not auto-match.

**Why:** A bank mutation is the only final evidence, while provider batches can be net of deductions and contain many payments. Guessing a provider or posting from a generated Sport Center mutation can create cross-provider matches and incorrect accounting.

**How to apply:** Keep `sport_payments` as the canonical payment source, preserve gross separately from observed deduction/net credit, calculate expected settlement with Asia/Jakarta business-day rules, persist deterministic candidate rows for audit, and route final action through the existing explicit approval mechanism.