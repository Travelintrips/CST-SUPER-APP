---
name: Marketplace RFQ retry idempotency
description: Durable safeguards for canonical Marketplace RFQ writes and legacy retry containment.
---

Canonical Marketplace RFQ creation must use a unique logical-request key in the dual-write ledger. The RFQ ID and successful ledger state must be committed in the same transaction; retry workers must atomically claim rows before processing, reuse an already-recorded RFQ, and treat exhausted rows as terminal. Legacy rows without a key should remain manual-only until they are explicitly reconciled.

**Why:** a retry path that calls the normal create function without a durable logical identity can create a second canonical RFQ on every retry cycle, while process-local locks do not protect multiple workers or deployments.

**How to apply:** deploy the schema/key migration before enabling the worker, keep the production kill switch available during rollout, and verify RFQ/log counts remain stable before re-enabling automatic retries.