---
name: Production approval idempotency timeout
description: Live approval can fail before business logic when lazy idempotency DDL contends for a production pool connection.
---

The bank approval route's idempotency middleware is compatibility-safe without an `x-idempotency-key`; when the header is present it lazily verifies and alters `processed_requests`, so pool contention can return HTTP 500 before the accounting transaction starts.

**Why:** A published approval request for an otherwise valid company-scoped manual COA was blocked by the lazy `CREATE TABLE IF NOT EXISTS` path while the table already existed; omitting the optional header reached the same authenticated approval handler and preserved the ledger safeguards.

**How to apply:** Treat this as an infrastructure failure, not a financial guard rejection. Confirm the target mutation is unchanged and journal-less, then use the documented no-key compatibility path only once for a controlled proof; separately harden idempotency storage initialization and production pool health.