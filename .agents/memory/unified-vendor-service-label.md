---
name: Unified vendor service label
description: Admin vendor-request read models must preserve the human-readable marketplace service identity.
---

For marketplace quote rows, resolve the displayed service identity from the canonical RFQ line item or catalog name before falling back to normalized service/category codes.

**Why:** Catalog service fields can contain only operational keys such as `trucking`; using that field first hides the actual service name (for example, `Jasa Trucking`) behind a generic label in Admin → Undang Vendor.

**How to apply:** Keep the normalized service key for filtering, but use the canonical line/catalog name for the human-readable raw service field and UI detail.