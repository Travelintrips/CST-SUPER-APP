---
name: Phase 4C-7A.5 mirror proof boundary
description: Development-only verification rules for the Sport Center mirror metadata contract.
---

For additive Sport Center mirror repairs, applying the metadata migration is not sufficient proof: verify the live PostgreSQL function and trigger definitions separately, because an older runtime function can remain installed after the columns exist.

**Why:** The development database initially had the new columns but still exposed the previous latest-booking mirror function; relying only on schema presence would have falsely certified the contract.

**How to apply:** Install and verify the trigger/function against the verified development database, prove resolver inputs and bridge uniqueness with read-only queries, and never replay historical payments while validating readiness.