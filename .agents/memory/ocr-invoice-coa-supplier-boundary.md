---
name: OCR invoice COA supplier boundary
description: Defines when an OCR vendor invoice needs an exact supplier-master match.
---

An explicitly selected COA is valid for the current OCR vendor invoice even when the OCR supplier name does not exactly match a supplier-master row. Only creation of a reusable supplier-specific COA mapping requires the matched supplier ID.

**Why:** Blocking the entire save conflates two separate outcomes and prevents valid invoices from being captured solely because OCR/vendor naming differs from the supplier master.

**How to apply:** Save the invoice and its confirmed line COA regardless of exact supplier-name matching. Run the reusable vendor-mapping step only when a company-scoped supplier master record is matched.