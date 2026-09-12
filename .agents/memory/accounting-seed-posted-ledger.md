---
name: Accounting seed posted-ledger safety
description: COA deduplication during startup must preserve posted journal line identities.
---

Startup COA deduplication must never rewrite or delete an account referenced by
posted journal lines. Move only mutable references; preserve historical account
rows with a unique legacy code when necessary so unique indexes can still be
created without violating ledger immutability.

**Why:** Production startup encountered an immutability trigger while trying to
reroute posted lines from duplicate COA rows, leaving readiness false.

**How to apply:** Any future COA cleanup or seed migration must distinguish
posted from mutable journal references and must fail closed rather than mutate
posted history.