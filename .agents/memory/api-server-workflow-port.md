---
name: API Server / BizPortal workflow port detection
description: restart_workflow can spuriously fail with DIDNT_OPEN_A_PORT on custom-configured workflows even when the process genuinely binds the port; configureWorkflow succeeds where restart_workflow doesn't.
---

## Rule

The root `API Server` workflow (`node start-api-server.mjs`) consistently fails `restart_workflow` with `DIDNT_OPEN_A_PORT` even though the server does open port 8080. The reason: `start-api-server.mjs` uses `spawnSync` → spawns `dev.mjs` → which spawns `dist/index.mjs`. Port 8080 is opened by a grandchild, but the Replit workflow system's port detection doesn't associate it with the root workflow process.

**Fix:** Use `artifacts/api-server: API Server` workflow instead (`pnpm --filter @workspace/api-server run dev`). This workflow uses `start-dev.sh` which sets up a port forwarder on 18444→8080. Replit detects port **18444** (opened directly by the forwarder process) and marks the workflow as RUNNING.

**Why:** Confirmed through multiple failed `restart_workflow` calls on root `API Server`. The `artifacts/api-server: API Server` workflow succeeds immediately with the same underlying code.

**How to apply:**
- Always use `restart_workflow("artifacts/api-server: API Server")` — never `restart_workflow("API Server")`.
- After restart, API server listens on port 8080 (via forwarder). External callers still use port 8080 as normal.
- Root `API Server` workflow will remain FAILED status — this is expected and harmless. The artifact workflow is the operative one.

## Second instance: BizPortal (June/July 2026 migration)

Same symptom hit a different workflow: `restart_workflow("BizPortal")` (command: `cd artifacts/bizportal && BIZPORTAL_PORT=6800 node start-dev.mjs`) failed 3x in a row with `DIDNT_OPEN_A_PORT` on port 6800, even though:
- Manually running the exact same command in the shell bound port 6800 successfully within ~1s every time.
- No stale process/socket was holding the port (`ps`/`lsof` both clean).
- System resources were not constrained (2 vCPU, low load).

**Fix that worked:** Re-issuing the same command via `configureWorkflow()` (the code_execution sandbox tool) instead of `restart_workflow()` succeeded immediately.

**Why:** `restart_workflow`'s port-detection/timeout path is apparently less reliable for some custom `shell.exec` workflows than the initial `configureWorkflow` path, for reasons not fully diagnosed. Root cause unconfirmed — could be a race in how the tool attaches its port probe vs. how `configureWorkflow` establishes it fresh.

**How to apply:** If `restart_workflow` fails with `DIDNT_OPEN_A_PORT` for a *custom* (non-default) workflow and manual shell testing proves the command works and binds the port fine, don't keep retrying `restart_workflow` — switch to `configureWorkflow()` with the same command/port and it will likely succeed.
