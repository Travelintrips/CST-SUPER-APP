---
name: CF-SC-10B proof boundary
description: Development smoke evidence and the missing settlement/public-mutation handoff in Central Finance processor orchestration.
---

The Central Finance processor can claim and post a confirmed Sport Center payment through the shared accounting owner, but a successful accounting post alone does not prove settlement or `public.bank_mutations` completion. The processor's current orchestration contract deliberately delegates accounting only; settlement must be proven through its canonical owner or an explicit downstream handoff.

**Why:** A rollback-only DEV smoke on 2026-08-20 produced one posted outbox row, one posted processing identity, and a balanced accounting journal, but no settlement batch or public bank mutation.

**How to apply:** Keep processor contract tests aligned with the intended ownership boundary, and do not mark CF-SC-10B complete until a DEV proof observes both canonical settlement and public mutation identities.