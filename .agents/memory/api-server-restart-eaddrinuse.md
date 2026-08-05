---
name: API server restart EADDRINUSE
description: api-server dev workflow frequently crash-loops on EADDRINUSE 8080 right after a restart; a second restart clears it.
---

# api-server restart → EADDRINUSE 8080 crash-loop

After restarting the `artifacts/api-server: API Server` workflow, it often enters a
crash-loop with `listen EADDRINUSE: address already in use 0.0.0.0:8080` because a
zombie process still holds port 8080 (the start-dev script also forwards 18444→8080).

**Why:** the previous node process hasn't released 8080 by the time the fresh build
boots; the supervisor retries every 1s but keeps hitting the held port.

**How to apply:** don't treat the first post-restart EADDRINUSE as a code bug. Just
restart the workflow a second time — it boots clean. Verify health with
`curl localhost:8080/api/<route>` (expect 401 on admin-gated routes = server up).
