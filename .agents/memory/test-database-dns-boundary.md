---
name: Test database DNS boundary
description: Isolated runtime tests require a resolvable TEST_DATABASE_URL target.
---

An available `TEST_DATABASE_URL` is not sufficient proof that runtime tests can run. If the configured hostname cannot resolve, stop before schema or data assertions and do not substitute DEV, PROD, or another database.

**Why:** The test database guard correctly accepts the isolated project identity, but DNS failure occurs before the connection reaches PostgreSQL; fallback would risk testing or mutating the wrong environment.

**How to apply:** Report the network/DNS blocker separately from code failures, and rerun the runtime suite only after the configured test host is reachable.