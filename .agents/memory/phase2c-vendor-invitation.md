---
name: Phase 2C Vendor Invitation
description: Lessons from implementing vendor invitation service (mkt_vendor_quotes, duplicate guard, token security).
---

## Rules

1. **uniqueIndex import**: drizzle-orm/pg-core schema files must explicitly import `uniqueIndex` alongside `index`. Forgetting it causes `ReferenceError: uniqueIndex is not defined` at server startup — crashes the entire API process.

2. **Race-safe duplicate guard**: Application-level SELECT-then-INSERT is NOT sufficient for concurrent requests. Always add a DB-level UNIQUE constraint `(rfq_id, vendor_id)` on mkt_vendor_quotes, catch PG error code `23505` in the service, and convert it to `DUPLICATE_INVITE`. DEV has this constraint; PROD does NOT yet — apply before Phase 2D goes live.

3. **Token in API response**: Vendor tokens (randomBytes(32).hex) must NEVER appear in API responses. Strip via destructuring `const { token: _token, ...safePayload } = notificationPayload` before `res.json()`. Token lives only in DB + activity_log internal audit.

4. **activity_logs mkt_* columns**: DEV was missing `mkt_rfq_id`, `mkt_vendor_quote_id`, `mkt_purchase_order_id` columns. Added via ALTER TABLE ADD COLUMN IF NOT EXISTS + FKs + indexes in Phase 2C. Schema now matches PROD.

**Why:** Security + correctness — token leakage is a security issue; non-atomic duplicate guard causes double-booking; missing columns cause silent logActivity failures.

**How to apply:** Any new marketplace entity that needs invitation/token pattern follows the same pattern: DB unique constraint + PG 23505 catch + token strip from response.
