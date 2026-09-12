---
name: Freight runtime forward migration
description: Freight shipment columns added after migration 0001 require an additive migration for already-applied environments.
---

The freight order schema must keep idempotent bootstrap statements in migration 0001 and separately track additive forward migrations for environments where 0001 or an earlier freight migration is already recorded. A table can exist while still missing later quote, approval, and tracking columns, so compare live columns against the full canonical contract rather than checking table existence alone.

**Why:** Runtime verification showed that editing an already-applied migration does not replay its new statements, and legacy freight tables may be structurally present but incomplete. Both cases leave the API schema behind the current freight contract.

**How to apply:** For future freight schema additions, update the fresh-bootstrap migration and add a separately tracked forward migration for each already-applied boundary; verify every required column and related table through `information_schema` in DEV and PROD before regression certification.