---
name: Freight runtime forward migration
description: Freight shipment columns added after migration 0001 require an additive migration for already-applied environments.
---

The freight shipment schema must keep the idempotent bootstrap statements in migration 0001 and also include an additive forward migration for environments where 0001 is already recorded as applied.

**Why:** Runtime development verification showed that editing an already-applied migration does not replay its new statements, leaving the API schema behind the current freight shipment contract.

**How to apply:** For future freight shipment schema additions, update the fresh-bootstrap migration and add a separately tracked forward migration; verify the development runtime through `information_schema` before regression certification.