---
name: Marketplace development DB connection routing
description: Development marketplace requests can stall in Supabase transaction-pooler checkout even when the SQL plan is fast.
---

For Marketplace API performance profiling, compare the configured development pooler URL with the development migration/direct URL before changing SQL. In the verified incident, the pooler path on port 6543 returned `ECHECKOUTTIMEOUT`, while `SUPABASE_MIGRATION_URL` on port 5432 completed the same database checks and Marketplace requests normally.

**Why:** A slow Marketplace page can be caused by connection checkout rather than query execution; `EXPLAIN (ANALYZE, BUFFERS)` on a healthy connection can otherwise misattribute the latency to SQL.

**How to apply:** Keep production routing unchanged. In development, prefer the working direct/migration URL when the pooler is demonstrably unavailable, then verify all Marketplace endpoints with repeated warm requests and confirm no pooler checkout errors in API logs.