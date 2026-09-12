---
name: Accounting journal status projection
description: Bank reconciliation UI must derive final mutation state from its linked accounting journal.
---

When a bank mutation has a linked accounting journal, a final journal state takes precedence over a stale mutation status in read projections: `posted` maps to posted, while `voided` or `reversed` maps to void.

**Why:** Historical recovery and legacy flows can commit the journal transition without updating the bank mutation row, which otherwise makes the UI offer draft actions for a finalized ledger entry.

**How to apply:** Keep list queries, status summaries, and action guards aligned with the linked journal status; never use the raw mutation status alone to offer posting or unapproval actions.