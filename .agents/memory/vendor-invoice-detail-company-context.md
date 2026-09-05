---
name: Vendor invoice detail company context
description: Company scope required when opening vendor invoice detail from BizPortal.
---

Vendor invoice detail requests must carry the active company context (`company`/`companyId`) when the authenticated admin session has no primary company; otherwise the API returns 400 and the editor can render undefined or NaN placeholders.

**Why:** The list page already supplied the company query, but the detail page did not, so clicking a valid invoice produced an empty editor instead of the invoice.

**How to apply:** Include the active company in the detail query key and request, handle non-OK responses before rendering, and keep financial formatters finite-safe.