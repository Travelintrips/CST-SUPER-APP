---
name: PROD read-only proof runner
description: Temporary production proof runners must preserve workspace module resolution and exact PostgreSQL parameter binding.
---

Run one-off Node proof code from the application workspace (or stdin launched
from that workspace), because a script placed directly under `/tmp` may not
resolve workspace dependencies such as `pg`.

**Why:** The production proof must fail only on a real database or evidence
condition; runner-level module-resolution and unused-parameter errors can look
like database failures and waste a read-only audit attempt.

**How to apply:** Keep SQL values parameterized, but pass a parameter array only
when the generated statement contains placeholders. For schema-driven queries
whose predicate is `TRUE`, send no parameters.