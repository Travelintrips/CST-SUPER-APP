---
name: Phase 4C-4 exclusion boundary
description: Canonical settlement exclusion must bridge mirrored Sport Center payment IDs and remain runtime-schema aware.
---

Individual Sport Center reconciliation candidates use trigger-owned public mirror rows, so canonical settlement membership must resolve `SCPAY-SC-{id}` to `sport_center.sport_payments.id` before checking active settlement items. Only `posted` and `reconciled` parent batches exclude a payment.

**Why:** The reconciliation database and canonical Sport Center source can use different payment IDs, and a reachable default development database may lack the `sport_center` settlement schema entirely. Treating the mirror ID as canonical or proving against the wrong database can silently miss exclusions.

**How to apply:** Keep one shared predicate for candidate SQL and approval-time revalidation. Preserve draft/calculated/reversed/voided eligibility in this phase, and verify canonical runtime tables before attempting live database proof.