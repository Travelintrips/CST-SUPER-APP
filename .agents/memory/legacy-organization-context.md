---
name: Legacy organization context
description: Resolution behavior for legacy Customer Portal customers with stale company memberships.
---

A legacy Customer Portal customer with `customer_type = NULL` must remain `legacy_unresolved` even when stale active membership rows exist. The canonical organization completion flow owns reconciliation: choosing individual deactivates those memberships; choosing a canonical company creates/retains the canonical membership.

**Why:** Inferring company context from old membership rows hides the completion prompt and can make an ambiguous legacy identity appear ready without an explicit customer choice.

**How to apply:** Treat the persisted customer type as authoritative for legacy resolution. Require explicit organization completion before RFQ creation, and prove both the resolved context and membership reconciliation.