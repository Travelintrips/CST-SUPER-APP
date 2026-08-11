---
name: Phase 4C-7P runtime blocked
description: Development runtime proof exposed a returned-versus-persisted score mismatch and pre-existing settlement linkage.
---

The Phase 4C-7P runtime proof must compare the exact `runUnifiedMatching()` result with the persisted `bank_reconciliation_matches` rows. In the observed development state, the engine returned canonical candidate 1 at 30 and candidate 2 at 20, while persisted rows showed both at 20. The same state already contained an active settlement item linking payment 22 to settlement 2, so the no-link assertion was not a clean proof condition.

**Why:** A passing in-memory ranking does not prove the database-backed candidate/rank contract, and pre-existing canonical links can invalidate a negative proof without any approval action in the harness.

**How to apply:** Keep 4C-7P blocked until the persistence mismatch is investigated and the development fixture/state is reset or explicitly accounted for. Do not change scoring or approve mutation 144 as part of the proof.