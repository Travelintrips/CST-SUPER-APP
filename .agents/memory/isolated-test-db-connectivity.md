---
name: Isolated test DB connectivity
description: Connectivity and schema prerequisites for the API regression suite's isolated Supabase test target.
---

The isolated Supabase test target may expose only a direct IPv6 database endpoint, while the Replit runner's Node `pg` client can fail with `ENOTFOUND` even when a shell DNS probe briefly returns an IPv6 address. Its project can also be reachable through a same-project pooler while still lacking the application schema required by DB-backed tests.

**Why:** substituting the development or production database would violate the regression suite's isolation boundary and could mutate business data. A reachable database is not evidence that the test schema is provisioned.

**How to apply:** preserve the test-target guard, verify the pooler belongs to the same isolated project before using it ephemerally for a test command, and report DNS/transport or missing-schema failures as infrastructure blockers rather than bypassing the guard or changing a live database without explicit approval.