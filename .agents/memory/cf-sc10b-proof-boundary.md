---
name: CF-SC-10B proof boundary
description: Development smoke evidence and the missing settlement/public-mutation handoff in Central Finance processor orchestration.
---

The Central Finance processor can claim and post a confirmed Sport Center payment through the shared accounting owner, but a successful accounting post alone does not prove settlement or `public.bank_mutations` completion. The processor's orchestration must reach the canonical settlement owner and explicit public-mutation handoff before CF-SC-10B is complete.

**Why:** A rollback-only DEV smoke on 2026-08-20 produced one posted outbox row, one posted processing identity, and a balanced accounting journal, but no settlement batch or public bank mutation.

**How to apply:** Keep processor contract tests aligned with the ownership boundary, and require DEV proof of both canonical settlement and public mutation identities. When bundling the rollback harness with esbuild, keep `runtime-db-guard.mjs` external so its CLI guard is not executed as a bundled side effect.