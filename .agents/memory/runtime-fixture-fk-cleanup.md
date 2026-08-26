---
name: Runtime fixture FK cleanup
description: Safe cleanup pattern for marker-scoped runtime proof fixtures with asynchronous descendants.
---

Fixture cleanup must discover all rows linked to the audit marker, delete actual FK descendants before parents, and isolate every table delete with a savepoint so one schema mismatch cannot abort the transaction.

**Why:** Approval flows can create descendants after the main harness has captured its IDs, and a fallback query that references a missing column aborts the whole PostgreSQL transaction, leaving unrelated cleanup steps unapplied.

**How to apply:** Keep discovery and final verification marker-scoped, include post-commit records and natural approval descendants, use live FK/schema names, and require both zero cleanup errors and zero residual records before certifying the proof.