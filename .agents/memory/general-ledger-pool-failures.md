---
name: General Ledger pool failures
description: How to handle intermittent PROD General Ledger failures caused by database pool checkout contention.
---

Treat `timeout exceeded when trying to connect` on the General Ledger as transient pool checkout contention, not as proof that the ledger SQL or schema is invalid. Retry only that connection-timeout class once; do not retry arbitrary SQL failures.

**Why:** PROD showed successful General Ledger requests followed by a failure while background workers were simultaneously timing out on pool checkout. The same account-scoped SQL succeeded quickly through an independent read-only connection.

**How to apply:** Correlate the request with nearby deployment logs, verify the SQL read-only against the correct PROD schema, keep retries bounded, and return a short safe UI message while retaining full error details only in server logs.