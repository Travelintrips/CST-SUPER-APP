---
name: CF-SC-10B proof boundary
description: Development smoke evidence, canonical settlement handoff, and retry-proof baseline rules for Central Finance processor orchestration.
---

The Central Finance processor must prove the complete ownership chain: durable claim, shared accounting owner, canonical settlement owner, and explicit public-mutation handoff. Retry proofs must compare financial effects with the payment-insert trigger baseline because that trigger can create the accounting draft before the processor runs.

**Why:** Accounting success alone once masked a missing settlement/public-mutation handoff. The live retry fixture also showed that insert-side trigger effects are valid pre-processor state, so a zero-effect assertion must be baseline-relative.

**How to apply:** Require DEV proof of settlement and public mutation identities, and assert transient attempts add no rows beyond the fixture baseline. When bundling the rollback harness with esbuild, keep `runtime-db-guard.mjs` external so its CLI guard is not executed as a bundled side effect.