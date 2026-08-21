---
name: CF-SC-10B harness baseline
description: Development rollback harnesses must compare dynamic snapshots rather than assume fixed counts for existing business rows.
---

The CF-SC-10B development harness must snapshot existing outbox and processing identities before creating its fixture, then compare the exact snapshot after rollback. It must not assert a historical hard-coded row count.

**Why:** Shared DEV data changes over time and fixed counts create false failures while weakening the meaningful invariant that unrelated identities remain unchanged.

**How to apply:** Use exact fixture IDs for fixture assertions and before/after identity snapshots for existing DEV integrity.

The live corruption/race harness must compile and resolve its normal configuration inside each rollback transaction before applying a temporary mutation; duplicate cleanup declarations and stale free variables can otherwise prevent any database proof from starting.

**Why:** The first live run exposed harness defects before reaching PostgreSQL behavior, so compile/runtime validation of the harness is itself part of the proof gate.

**How to apply:** Run the bundled harness after every harness edit and treat precondition/cleanup failures as harness failures, not business-proof results.