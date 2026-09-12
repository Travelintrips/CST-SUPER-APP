---
name: Vendor company-assignment IDOR pattern
description: PUT/GET endpoints touching a per-resource company scope must call assertCompanyAccess with the resource's own companyId, not just requireAdmin.
---

`requireAdmin`/`requireClerkUser` only prove the caller is an authenticated admin — they do NOT prove the target resource belongs to that admin's company. Any endpoint that mutates or reads a per-company-scoped resource by ID (e.g. `/suppliers/:id/companies`) must additionally fetch the resource's `companyId` and call `assertCompanyAccess(resourceCompanyId, resolveCompanyId(req), req, res, { resourceType, resourceId })` before proceeding.

**Why:** found `PUT /api/trading/suppliers/:id/companies` had `requireAdmin` but no ownership check, unlike its sibling `PUT /suppliers/:id` and `POST /suppliers/bulk-assign-company` — a company-scoped admin could reassign another company's vendor. Sibling endpoints on the same resource can silently diverge in their auth checks; always compare against a route that touches the *same* resource, not just the general auth story.

**How to apply:** when auditing or adding any `:id`-scoped write endpoint on a multi-tenant table, check the endpoint fetches the row's `companyId` first and runs `assertCompanyAccess` (see `artifacts/api-server/src/lib/assertCompanyAccess.ts`) — don't assume `requireAdmin` alone is enough.
