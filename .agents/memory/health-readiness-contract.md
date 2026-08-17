---
name: Health readiness contract
description: Runtime behavior and middleware placement for API liveness/readiness probes.
---

`/api/health/live` must be registered before bearer-rate-limit and authentication middleware and must not touch the database, migrations, session storage, or external services. `/api/health/ready` is a separate diagnostic contract and may remain `starting` while the serial startup migration chain runs.

**Why:** When liveness passed through auth/pool-adjacent work, cold-start probes were delayed even though the Node process was accepting requests. A measured development cold start completed readiness only after roughly 353 seconds while liveness stayed around 0–3 ms.

**How to apply:** Keep frontend startup polling separate: use liveness for API reachability and readiness for migration availability. Expose readiness phase and migration timestamps so long startup is diagnosable rather than mistaken for process failure.