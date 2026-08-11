---
name: Phase 4C-7P runtime evidence
description: Active canonical candidate persistence is correct; proof queries must exclude superseded history.
---

The Phase 4C-7P runtime proof must compare the exact `runUnifiedMatching()` result with only active `bank_reconciliation_matches` rows (`status IN ('candidate', 'approved')`). Mutation 144's development state contains active canonical candidates 1 and 2 at 30 and 20, plus superseded historical duplicate rows. A query that omits the active-status filter can select a stale 20-point row and falsely report that persistence lost the exact-date bonus. The same state contains an existing active settlement item linking payment 22 to settlement 2, so that negative assertion is a fixture-state fact, not an approval side effect.

**Why:** Superseded candidate history is intentionally retained, so reading by identity alone is nondeterministic when duplicate rows exist. Pre-existing canonical links can also invalidate a negative proof without any approval action in the harness.

**How to apply:** Filter active rows before checking score, rank, count, or uniqueness. Do not change scoring or approve mutation 144 as part of the proof.