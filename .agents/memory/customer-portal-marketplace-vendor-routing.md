---
name: Customer Portal marketplace vendor routing
description: Marketplace RFQ admin flow keeps vendor onboarding and RFQ quote invitation distinct while routing product-owner invitations through Customer Portal.
---

The vendor invitation link in Customer Portal creates or approves the supplier master record; it does not by itself create a vendor quote for a marketplace RFQ. A product-originated RFQ must resolve its catalog owner and create the RFQ-specific vendor quote before deal pricing can be edited.

**Why:** Treating an approved supplier as an existing RFQ quote made Customer Portal show `Vendor Quotes (0)` and incorrectly sent admins to BizPortal.

**How to apply:** Keep product-owner routing, RFQ invitation, quote status, and deal-price editing visible in Customer Portal. Only expose deal pricing after a vendor quote is submitted or selected.

The vendor dashboard may show Marketplace RFQs and issued Marketplace POs only through
`vendor_profiles.supplier_id` → the Marketplace vendor/PO owner. RFQ response uses the
existing quote token form; PO acceptance/rejection remains a separate PO token flow.

**Why:** Marketplace RFQs and logistics RFQs have different lifecycles, and an RFQ
numeric ID is not safe to mix with a logistics RFQ ID. Reusing the existing token
flows preserves their validation and transition guards.

**How to apply:** Keep `marketplaceRfqs` and `marketplaceOrders` as separate response
collections, scope both by the canonical supplier FK, and never match commercial
visibility by email or phone.