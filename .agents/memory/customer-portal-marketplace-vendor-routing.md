---
name: Customer Portal marketplace vendor routing
description: Marketplace RFQ admin flow keeps vendor onboarding and RFQ quote invitation distinct while routing product-owner invitations through Customer Portal.
---

The vendor invitation link in Customer Portal creates or approves the supplier master record; it does not by itself create a vendor quote for a marketplace RFQ. A product-originated RFQ must resolve its catalog owner and create the RFQ-specific vendor quote before deal pricing can be edited.

**Why:** Treating an approved supplier as an existing RFQ quote made Customer Portal show `Vendor Quotes (0)` and incorrectly sent admins to BizPortal.

**How to apply:** Keep product-owner routing, RFQ invitation, quote status, and deal-price editing visible in Customer Portal. Only expose deal pricing after a vendor quote is submitted or selected.