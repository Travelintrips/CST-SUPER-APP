---
name: DB pool exhaustion on startup
description: 17 workers + boot migrations compete for pool connections; max=3 was too low
---

## Rule
Dev pool max should be 8 (not 3) in lib/db/src/index.ts.

## Why
API server starts 17 background workers with stagger delays, plus runs boot migrations at startup. With max=3, all connection slots are exhausted during the first few seconds, causing "timeout exceeded when trying to connect" errors on regular API queries.

## How to apply
Current setting in `lib/db/src/index.ts`: `isProdEnv ? 2 : 8`
Prod stays at 2 to avoid pgBouncer auth-failure throttle.
