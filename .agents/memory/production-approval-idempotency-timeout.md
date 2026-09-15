---
name: Production approval idempotency timeout
description: Live approval can fail before business logic when lazy idempotency DDL contends for a production pool connection.
---

The bank approval route's idempotency middleware is compatibility-safe without an `x-idempotency-key`; keyed requests require `processed_requests` to be provisioned by startup/deployment migration and fail with a controlled 503 while storage is unavailable.

**Why:** A published approval request for an otherwise valid company-scoped manual COA was blocked by the lazy `CREATE TABLE IF NOT EXISTS` path while the table already existed; omitting the optional header reached the same authenticated approval handler and preserved the ledger safeguards.

**How to apply:** Treat this as an infrastructure failure, not a financial guard rejection. Confirm the target mutation is unchanged and journal-less, then use the documented no-key compatibility path only once for a controlled proof. Keep DDL in startup/deployment migration; request handling may only query/insert and must return `IDEMPOTENCY_STORAGE_UNAVAILABLE` with retry guidance when storage is unavailable.