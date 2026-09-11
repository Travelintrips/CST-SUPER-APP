---
name: Portal authenticated query reuse
description: Performance boundary for authenticated Customer Portal list endpoints under Supabase pooler contention
---

Authenticated Customer Portal read routes should pass the customer row already loaded by auth middleware into their service layer instead of querying the same identity again.

**Why:** The dashboard opens several protected reads in parallel. Repeating the identity query in every service adds avoidable pooler work and magnifies latency when the shared transaction pool is contended.

**How to apply:** Keep the service fallback query for direct callers, but route handlers should pass the middleware-authenticated customer whenever the endpoint is protected by the canonical portal auth middleware.