---
name: Audit proof cleanup boundary
description: Safe cleanup rules for development fixtures when audit tables are append-only.
---

Development proof cleanup must remove only synthetic business fixtures and their mutable notification/profile rows. Append-only ERP audit evidence should remain untouched; use a unique marker and verify the mutable residual set separately.

**Why:** A cleanup that deletes audit history to make a fixture count reach zero destroys the very evidence the proof is intended to preserve.

**How to apply:** Generate a unique fixture marker, delete only known mutable descendants in a transaction, and report any marker-bearing append-only audit rows as retained evidence rather than cleanup failure.