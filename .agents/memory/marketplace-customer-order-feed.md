---
name: Marketplace customer order feed
description: Canonical Marketplace RFQs must remain visible in the customer's general order history before approval.
---

The customer-facing order history must read canonical `mkt_rfqs` in addition to legacy `portal_product_orders`. RFQ approval is a lifecycle update, not a visibility gate: `submitted`, `draft` with pending approval, and later statuses remain customer-visible when owned by the session customer or their active company scope.

**Why:** Admin Operations reads `mkt_rfqs`, while the older customer feed reads `portal_product_orders`; without the canonical feed, a real RFQ can appear to admins but look missing to its creator.

**How to apply:** Use the authenticated Marketplace RFQ endpoint for the customer feed, link rows to RFQ detail, label approval separately from RFQ status, and apply individual ownership by `portal_customer_id` plus company ownership by active canonical `company_id`.