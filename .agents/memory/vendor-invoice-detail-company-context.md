---
name: Vendor invoice detail company context
description: Company scope required when opening vendor invoice detail from BizPortal.
---

Vendor invoice detail and posting requests must carry the active company context (`company`/`companyId`) when the authenticated admin session has no primary company; otherwise the API returns 400 and the editor can render undefined or NaN placeholders or posting cannot resolve ownership.

**Why:** The list page already supplied the company query, but detail and post actions did not, so clicking a valid invoice produced an empty editor and posting failed before reaching Finance validation.

**How to apply:** Include the active company in detail and mutation requests, include it in query keys, handle non-OK responses before rendering, and keep financial formatters finite-safe.