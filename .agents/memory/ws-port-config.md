---
name: ws Package & Customer Portal Port
description: Two recurring infra quirks — ws external/install and customer portal port mismatch with gateway
---

## ws Package in api-server

`ws` is imported in `alertsBroadcast.ts` and `supabaseAdmin.ts`. Two steps required:

1. Add `"ws"` to the `external` array in `artifacts/api-server/build.mjs` (so esbuild doesn't bundle it)
2. Run `pnpm install --filter @workspace/api-server` to link the package into `artifacts/api-server/node_modules/`

**Why:** pnpm workspace stores ws in `.pnpm/ws@8.20.1/node_modules/ws` but does not auto-link it to the package's local `node_modules` unless explicitly installed. Marking as external alone causes a runtime "Cannot find package 'ws'" error; install alone causes a bundle error if not also external.

## Customer Portal Port vs Gateway

Replit auto-assigns `PORT=23434` to the customer portal workflow. The `start-dev.sh` reads `ARTIFACT_PORT=${PORT:-3001}`, so the HTTP proxy binds to **23434**, not 3001.

The Gateway workflow uses `CUSTOMER_PORT` (default 3001). Fix: set `CUSTOMER_PORT=23434` in the Gateway command:

```
PORT=5000 CUSTOMER_PORT=23434 node gateway.mjs
```

**How to apply:** Whenever the customer portal workflow port changes (check logs for `[customer-portal] HTTP proxy :XXXX -> :5173`), update the Gateway workflow command accordingly via `configureWorkflow()`.
