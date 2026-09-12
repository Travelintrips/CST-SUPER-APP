---
name: Marketplace Product Order ownership
description: Ownership boundary between canonical Marketplace RFQs and the compatibility Product Order projection.
---

The Marketplace compatibility projection must persist the authenticated session's canonical `portal_customer_id` on `portal_product_orders`; `company_id` alone is insufficient for individual customers.

**Why:** Admin read models can still show a compatibility order when the customer owner is missing, while the Customer Portal feed correctly filters it out. That creates a silent cross-surface ownership regression.

**How to apply:** On authenticated Marketplace submissions and compatibility retries, copy the verified session owner into the projection. Keep guest submissions ownerless and verify both Admin visibility and customer feed visibility in runtime proofs.