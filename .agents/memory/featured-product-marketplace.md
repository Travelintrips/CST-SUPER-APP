---
name: Featured Product marketplace feature
description: Vendor-paid "featured product" promotion system across Customer Portal + BizPortal + API server — architecture, endpoints, and known gaps.
---

Marketplace feature letting vendors pay to promote a catalog item (badge + priority placement) for a package duration. Single backend, shared by two frontends (Customer Portal admin tab, BizPortal admin page) plus a vendor self-service tab.

**Backend** (`artifacts/api-server/src/lib/services/marketplaceFeaturedProductService.ts`, mounted under `/api/portal` in `routes/portal.ts`):
- Request lifecycle: `pending → approved → active → expired|rejected|cancelled`; separate `paymentStatus`: `unpaid → pending_verification → verified|rejected`.
- Vendor-ownership check (403 on cross-vendor submission), server-side price lookup (never trusts client price), duplicate-active-request guard, atomic activation via `db.transaction()`.
- Expiry worker (`featuredProductExpiryWorker.ts`) deactivates expired items with a concurrency lock + status-guarded WHERE to avoid double-processing.
- `createFeaturedRequest(vendorId, input)` takes vendorId as a **separate first argument**, not part of the input object — a route call passing one merged object was the one real bug found and fixed.

**Why the frontend took a second pass:** an earlier session's explorer subagent reported the frontend "complete" based only on the public marketplace badge display (`marketplace.tsx`) — the actual admin/vendor request-management UI (Customer Portal admin tab, BizPortal admin page, vendor self-service tab) did not exist yet. Grep for the literal feature name/endpoints before trusting an "already done" claim on a multi-surface feature — a partial surface being done doesn't mean the others are.

**How to apply:** When resuming/auditing this feature, verify all three UI surfaces independently (grep each app for the admin/vendor endpoint paths, not just the public one) before assuming completeness. Dev auth for manual smoke testing: `POST /api/portal/auth/dev-login` body `{"role":"admin"|"vendor"|"customer"}` returns a bearer token (`Authorization: Bearer <token>` header, not a cookie) usable against `/api/portal/admin/*` and `/api/portal/vendor/*` routes in dev.
