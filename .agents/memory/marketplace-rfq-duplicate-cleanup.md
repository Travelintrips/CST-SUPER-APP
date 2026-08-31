---
name: Marketplace RFQ duplicate cleanup
description: Safe cleanup preserves retry audit evidence while removing only exact retry-generated duplicate request scope.
---

Production RFQ cleanup must use a freshly derived exact manifest, a complete rollback snapshot, and a locked fail-closed transaction. Delete only duplicate headers and their duplicate-only lines; preserve dual-write retry ledger rows as audit evidence, and preserve activity rows when the live FK safely nulls the deleted RFQ reference.

**Why:** The retry incident produced duplicate request headers with 1,292 activity and 1,292 dual-write audit rows. Removing audit evidence would make the incident unreconstructable, while the live activity FK already provides safe de-linking.

**How to apply:** Require exact candidate-count and dependency assertions before commit, protect canonical representatives, keep the dual-write ledger, and verify final canonical IDs plus orphan counts after cleanup.