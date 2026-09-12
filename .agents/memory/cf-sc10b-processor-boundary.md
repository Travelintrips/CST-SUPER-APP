---
name: CF-SC-10B processor boundary
description: The restored central processor must orchestrate the Sport Center outbox and delegate accounting ownership to the database function.
---

The CF-SC-10B processor is an orchestration layer only: claim durable outbox work with locking, call `sport_center.create_payment_accounting_draft`, and persist retry/manual-review state. It must not duplicate shared config, tax, COA, settlement, or bank-mutation logic.

**Why:** The development runtime proves the database function is the current canonical accounting owner; the historical TypeScript helper is generic legacy code and is not safe to resurrect as the central owner.

**How to apply:** Keep `SPORT_CENTER_FINANCE_MODE=legacy` until a development-only processor smoke proves the central path, then build the rollback-only harness.