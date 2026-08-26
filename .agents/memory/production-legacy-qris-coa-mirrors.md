---
name: Production legacy QRIS COA mirrors
description: Live-production COA mirror requirements for the legacy Sport Center QRIS settlement owner.
---

The legacy Sport Center settlement owner validates its own `sport_center.coa_accounts` namespace even when the matching public COA is active and correctly linked. Its canonical receiving-bank check requires the exact active asset identity for `1-1023-CST` / `Bank Mandiri Ciputat`; an MDR-positive batch additionally requires active expense code `61.16` in that internal namespace.

**Why:** Production can have valid public COA IDs and posted historical ledger lines while the internal mirror is empty or while the public account's secondary `account_type` metadata has drifted. The approval then stops before settlement creation with a canonical bank-COA or MDR-COA guard error.

**How to apply:** Preserve existing public COA IDs and posted journal lines. Before approving a legacy QRIS group, verify exactly one active public receiving-bank mapping, matching internal bank mirror, and—when MDR is positive—internal `61.16` expense mirror. Treat this as a legacy-owner compatibility requirement; do not substitute or rewrite payment history.