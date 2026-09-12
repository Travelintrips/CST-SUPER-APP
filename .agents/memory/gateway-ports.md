---
name: Gateway holding-page despite healthy Vite = proxy/gateway port mismatch
description: Heuristic for when a gateway-routed artifact preview hangs on "starting…" though its dev server is up
---

**Symptom → cause:** A gateway-routed artifact preview stuck on a "starting…/
upstream not ready" holding page **while that artifact's own Vite log says "ready"**
means the artifact's gateway-facing proxy is listening on a different port than the
one `gateway.mjs` targets for that prefix.

**Why it happens here:** Each artifact's `start-dev.sh` runs Vite on the
Replit-assigned `PORT` and, when different, spins a small proxy on a gateway-facing
port that defaults via `${SOMEVAR:-N}`. The canonical artifact-namespaced workflows
(`artifacts/<x>: web`) do NOT set that env, so the **start-dev.sh fallback** must
equal the **gateway.mjs fallback** for that route, or the proxy binds the wrong port.

**How to apply:** When you see this symptom, diff the start-dev.sh fallback port
against the gateway.mjs default for the prefix and make them match (fix in
`artifacts/`, never the root gateway). Also: the legacy short-named workflows
(`BizPortal`, `API Server`, `Customer Portal`) are stale duplicates that collide on
the same ports as the artifact-namespaced set and are expected to stay failed — the
artifact-namespaced workflows are the canonical ones serving the gateway; do not
restart the legacy ones alongside them.
