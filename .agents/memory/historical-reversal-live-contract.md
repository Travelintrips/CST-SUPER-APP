---
name: Historical reversal live contract
description: Controlled production duplicate reversal must be validated against the active owner contract and live payment-booking identity.
---

The historical duplicate reversal procedure and the checked-in owner implementation can diverge; a stale validate-only runner must never be treated as production authorization. Production writes require a fresh read-only proof against the active contract, including the canonical payment-to-booking identity chain.

**Why:** A historical reversal batch can appear structurally valid while the live identity relationship no longer matches, so relying on an older runner or pair list can create an incorrect financial correction.

**How to apply:** Inspect the active owner signature and run a production read-only preflight first. Treat any identity mismatch as fail-closed and do not fall back to raw SQL or the legacy runner.