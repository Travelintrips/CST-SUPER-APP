---
name: Reconciliation repair diagnosis
description: Safety boundary for runtime reconciliation repair diagnostics and generated SQL.
---

The repair diagnosis must be based on the current mutation, match, candidate, company, and journal rows. Exact SQL is allowed only when one approved match is stale on an `unmatched` mutation with no journal entry; it may release that match to `candidate` and write an audit row, but must not rewrite financial data.

**Why:** Posted journals, reversal chains, canonical QRIS settlement ownership, ambiguous matches, and mismatched company scope can change ledger meaning. A broad SQL repair can make the UI look consistent while leaving accounting state incorrect.

**How to apply:** Generate SQL with exact runtime IDs, ownership/status pre-checks, row locks, `RAISE EXCEPTION` on drift, explicit transaction boundaries, and BEFORE/AFTER verification. Route balanced draft journals through the existing guarded posting endpoint; classify posted or canonical cases as developer action required rather than emitting partial SQL.