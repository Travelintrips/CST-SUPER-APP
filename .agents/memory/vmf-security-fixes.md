---
name: VMF Security & Race Condition Fixes
description: Fixes applied to vendorMiniForm.ts after full system audit — transaction isolation, rate limiting, validation, data hygiene.
---

## Fixes Applied (artifacts/api-server/src/routes/vendorMiniForm.ts)

**Race condition — customer approval double-approve:**
- Wrapped entire customer-approval POST in `db.transaction()`
- Atomic UPDATE with `WHERE status='pending'` — jika rows[0] undefined → throw `ALREADY_RESPONDED`
- No longer relies on pre-check + separate update (TOCTOU eliminated)

**SO number format changed:**
- Old: `SO/YYYYMM/00042` (predictable from approval.id)
- New: `SO/YYYYMM/00424F9A` (approval.id + 4 random hex chars via `randomBytes(2).toString("hex").toUpperCase()`)

**itemStatus state machine completed:**
- After customer approves, `vendorMiniFormLinksTable.itemStatus` is now updated to `customer_approved` within same transaction
- Covers all links with `mode='order_based'` for the given orderId

**Rate limiting — public VMF endpoints:**
- `vmfGetLimiter`: 60 req / 15 min per IP (GET)
- `vmfPostLimiter`: 10 req / 15 min per IP (POST)
- Applied via router middleware, skips `/admin` routes
- Uses `express-rate-limit` (already in package.json)

**maxSubmissions race condition:**
- count() + insert() now wrapped in `db.transaction()`
- Throws `QUOTA_EXCEEDED` if count >= max — caught in outer catch block → 410 response

**offerSummary information disclosure:**
- Added `sanitizeOfferSummary()` helper with `SAFE_OFFER_SUMMARY_KEYS` whitelist
- Applied to GET /customer-approval/:token response
- Keys: serviceType, origin, destination, weight, volume, commodity, incoterms, eta, notes, items, services
- vendorCost, markupPct, vendorPrice etc. are NOT in whitelist

**Server-side required field validation:**
- Added validation block in POST /:token using SERVICE_SCHEMAS[link.serviceType]
- Checks required fields per phase (quotation/operational/both)
- Returns 400 with list of `missingFields`

**Audit trail for delete:**
- `DELETE /admin/submissions/:id` now calls `logActivity("submission", id, "deleted", userId, ...)` before returning

**Pagination for admin submissions:**
- GET /admin/submissions now accepts `?limit=100&offset=0` (max limit 500)
- Default 100 per page

**Why:**
All these were identified in a full system audit as CRITICAL/HIGH issues. The double-approve race condition was the most dangerous (could produce duplicate SO numbers or inconsistent DB state). Rate limiting prevents token enumeration and form spam.

**How to apply:**
No schema changes needed. All fixes are code-only in `vendorMiniForm.ts`.
