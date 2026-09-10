---
name: Marketplace deal price boundary
description: The Marketplace RFQ commercial-price separation and immutable downstream snapshot rule.
---

Vendor quote cost is an internal source price. Admin-negotiated deal price is the customer-facing transaction price and must remain in separate fields. Customer quotation, approval, PO, and invoice must use the deal-price snapshot; missing deal price is a hard failure, never a fallback to vendor cost or zero.

**Why:** A vendor-cost overwrite leaks margin and makes the approved customer commercial value impossible to audit or reproduce.

**How to apply:** Keep vendor and deal values visible only on the authorized admin surface, lock deal changes after customer review/approval, preserve previous/new values in audit evidence, and validate invoice lines against the PO snapshot.