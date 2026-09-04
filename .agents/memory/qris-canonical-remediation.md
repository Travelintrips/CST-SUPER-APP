---
name: QRIS canonical remediation
description: Safe sequencing for stale snapshots and invalid reconciled membership corrections.
---

Stale QRIS snapshots must be retired before correcting a reconciled canonical batch. A reconciled batch intentionally suppresses candidate generation, so refreshing it first can produce no candidate while still safely closing provisional evidence. Membership correction must then reverse the posted settlement in a transaction; the replacement cohort is rebuilt and approved separately, never inferred from nominal alone.

**Why:** The live contract excludes mutations already linked to reconciled canonical batches, and the audited invalid batches have payment/date or provider-rule conflicts that make a direct replacement unsafe.

**How to apply:** Use the production Secret Manager loader and the manifest-gated runner for one mutation at a time. Preserve valid/orphan/reversed history, require an exact replacement set, and stop for manual review when the builder cannot prove provider, H-1, MDR, and bank-amount invariants.