# R-2 — Expense Idempotency

## Summary
Added idempotency middleware to `POST /api/expenses` to prevent duplicate expense records when clients retry failed requests.

## Problem
Without idempotency, a network timeout or client retry on expense creation could create two identical expense records, causing:
- Double accounting entries
- Inflated expense totals
- Audit discrepancies

## Fix

### Idempotency system (`lib/financial/idempotency.ts`)
A general-purpose idempotency middleware factory that:
1. Reads `x-idempotency-key` header from incoming request.
2. Checks `processed_requests` table for a cached response.
3. If **cache hit** → returns the stored response immediately (no re-processing).
4. If **cache miss** → runs the route handler, then stores the response.
5. Cache TTL: **24 hours** (configurable).

```typescript
// Usage
router.post("/", createIdempotencyMiddleware("expense:create"), handler);
```

### processed_requests table
```sql
CREATE TABLE processed_requests (
  idempotency_key TEXT NOT NULL,
  namespace       TEXT NOT NULL DEFAULT 'default',
  response_code   INTEGER NOT NULL DEFAULT 200,
  response_body   JSONB,
  actor           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  PRIMARY KEY (idempotency_key, namespace)
);
```

- **Namespace** isolates keys by domain (e.g. `expense:create` vs `payment:post`).
- **Expires_at** allows natural expiry; a cleanup job can purge old entries.
- `ON CONFLICT DO NOTHING` on insert is safe against concurrent races.

### Backward compatibility
- Requests **without** `x-idempotency-key` pass through unchanged (no header = no idempotency check).
- Existing integrations are not broken.

## Test coverage
`artifacts/api-server/src/__tests__/r2-expense-idempotency.test.ts`

| Test | Verifies |
|---|---|
| 1 | `createIdempotencyMiddleware` called with `expense:create` namespace |
| 2 | POST without key → backward compatible (returns 400 for missing categoryId, not a middleware error) |
| 3 | Namespace is correctly `expense:create` |

## Security considerations
- Idempotency keys are **client-generated UUIDs** — no server-side secrets involved.
- Keys are scoped by namespace so a key in `expense:create` cannot collide with `payment:post`.
- No PII in `processed_requests` — only status code and response body (which may contain record IDs).
- Expired entries are retained until explicitly purged (acceptable for 24h window).

## Scope
R-2 applies idempotency to expense creation. The same middleware is available for other financial POST routes (bank-reconciliation approve, accounting payments, journal entries) and can be added incrementally.
