---
name: Token Security Hardening P0-P2
description: HMAC-SHA256 hash storage, 256-bit tokens, rate limiters, rotation, cleanup worker, stats endpoint, TokenErrorPage redesign, and TOCTOU-safe atomic consumption.
---

## Completed hardening layers

### P0 — Token generation & storage
- `generateTokenPair()` in `lib/tokenUtils.ts` returns `{ raw, hash }` (256-bit random, HMAC-SHA256).
- All token tables store `token_hash TEXT` (nullable) alongside `token` TEXT for backward-compat.
- Boot migration in `runCriticalPreStartMigrations()`: `ALTER TABLE IF EXISTS … ADD COLUMN IF NOT EXISTS token_hash TEXT` — idempotent, no DO blocks (avoids pgBouncer param-binding issue).
- Tables covered: admin_action_links, rfq_vendor_links, vendor_fulfillment_links, customer_quote_links, order_task_links, customer_order_links, order_fulfillment_links, customer_feedback_links, purchase_mini_forms, vendor_mini_form_links, customer_approvals, customer_invoice_links, vendor_catalog_submission_links, mkt_vendor_quotes.

### P0 — Hash-first dual-token lookup
- Pattern: `WHERE (token_hash = ${hash} OR (token_hash IS NULL AND token = ${raw}))` using Drizzle `sql` template.
- `dualTokenParams(raw)` from `tokenUtils.ts` returns `{ raw, hash }` for use in the WHERE.
- Legacy rows (token_hash IS NULL) fall back to plaintext; new rows match by hash only.
- Applied in: `vendorCatalogEngine.ts` GET/POST public routes.

### P0 — TOCTOU-safe atomic token consumption
- Single-use tokens (compare_vendors, forward_vendor, confirm_fulfillment in adminAction.ts) MUST claim the token BEFORE executing any business-logic mutations.
- Pattern: `UPDATE … SET used_at=NOW() WHERE token=? AND used_at IS NULL AND revoked_at IS NULL RETURNING id`. If 0 rows → return 409 immediately.
- **Why:** TOCTOU means two concurrent requests both read usedAt=NULL, both pass validation, both execute mutations. Claiming first means only one proceeds.
- review_order (blast_vendors) is intentionally multi-use; it uses blastInProgress Set guard instead.

### P1 — Token rotation
- On new token creation for same (orderId, actionType), old active tokens are revoked: `UPDATE … SET revoked_at=NOW() WHERE … AND revoked_at IS NULL AND used_at IS NULL`.

### P2 — Audit & rate limiting
- `logTokenAccess()` in `tokenGuard.ts` writes to `token_access_log` with request_id, route, latency, response_status.
- `/vendor-catalog-engine` added to the strict GET/POST rate-limiter mount list in `routes/index.ts`.
- `customer-portal` TokenErrorPage handles: expired, revoked, used, invalid, rate_limited (429 → rate_limited mapping).

### tokenGuard.ts fail-closed fix
- `checkToken()` returns 404 (not ok) when all token fields (expiresAt, revokedAt, usedAt, isActive, status, isUsed) are null/undefined AND `exists` is undefined — prevents leaking ok:true on empty rows.

**Why all these are in lib/tokenUtils.ts:**
Single canonical source; api-server imports via `import { generateTokenPair, hashToken, dualTokenParams } from "../lib/tokenUtils.js"`.
