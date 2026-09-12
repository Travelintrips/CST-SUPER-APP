---
name: Marketplace proof ledger cleanup
description: DEV all-services proof cleanup must explicitly handle Marketplace dual-write rows when FK discovery is incomplete.
---

Development proof fixtures can leave `mkt_dual_write_log` rows even after RFQ and portal-order roots are removed, because some DEV schema snapshots do not expose a discoverable FK for that audit ledger.

**Why:** Generic FK traversal cannot guarantee cleanup of an audit child whose linkage is application-level or absent from the live catalog; residual proof rows can contaminate later visibility and duplicate checks.

**How to apply:** During DEV-only proof cleanup, delete only rows tied to the exact proof RFQ/order IDs or unique marker, then assert the ledger has no remaining matching rows. This does not change the production rule to preserve historical audit evidence.