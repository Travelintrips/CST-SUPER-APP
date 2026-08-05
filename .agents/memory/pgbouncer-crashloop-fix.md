---
name: pgBouncer crash-loop amplification fix
description: How crash loops amplify pgBouncer auth failures; file-based CB solution.
---

## Problem
When api-server crash-loops (e.g. EADDRINUSE), each process restart immediately runs `startupProbe` in lib/db/src/index.ts which opens a new connection to Supabase pgBouncer. At 1s retry interval with 17 workers, this generates dozens of auth failures per minute — causing pgBouncer to enter ECIRCUITBREAKER mode, which then causes MORE failures.

## Fix: File-based Circuit Breaker
`/tmp/db-startup-cb.json` is written when startup probe detects auth failure. Subsequent process restarts read this file and skip the probe entirely (returning the cached block status) until the file expires.

**Format:** `{ "blockedUntil": <unix_ms>, "message": "<pgBouncer error>" }`

**Location:** `lib/db/src/index.ts` — `CB_FILE` constant, written in startupProbe on auth failure.

**Why:** In-memory CB state dies with the process. File-based state persists across restarts, preventing the crash-loop amplification pattern.

## dev.mjs crash retry
Raised from 1s → 30s in `artifacts/api-server/dev.mjs` to give time between retries.

## Recovery procedure
When fixing credentials or after waiting for pgBouncer to clear:
1. `rm -f /tmp/db-startup-cb.json`
2. `fuser -k 8080/tcp`
3. Restart API Server workflow

**How to apply:** Any time api-server is in a crash loop hitting Supabase auth errors.
