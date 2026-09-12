---
name: Control plane architecture
description: System watchdog must be a standalone service — never embedded in gateway. Spawn from gateway = crash. Control plane endpoints proxied through gateway.
---

## Rule

The system watchdog (circuit breaker, health monitor, control API) runs as **`system-watchdog-service.mjs`** — a separate Node.js process. Default `WATCHDOG_PORT=3001` in workflow env; actual bound port may be 3002+ if 3001 is taken by the `customer-portal` artifact.

The gateway (`gateway.mjs`) is a **pure data plane**: it only routes, proxies, and retries. It contains zero monitoring or spawn logic.

**Why:** Embedding the watchdog inside the gateway caused the gateway process to crash when auto-restart used `spawn()`. The only safe fix is architectural separation.

**How to apply:**
- Never import `system-watchdog-service.mjs` or any spawn-using module from `gateway.mjs`.
- Gateway `/system/health` → inline JSON response (no external call).
- Gateway `/system/global-health` → `proxyToWatchdog()` which reads `/tmp/watchdog-actual-port.txt`.
- Watchdog `waitForPort=3002` (workflow config) — because `customer-portal` artifact often claims 3001.
- Watchdog writes actual port to `/tmp/watchdog-actual-port.txt` after successful bind.
- Gateway `resolveWatchdogPort()` reads that file, falls back to `WATCHDOG_PORT` env.

## Static Port Binding (watchdog — SYSTEM_MODE=PROD)

`system-watchdog-service.mjs` now binds to `WATCHDOG_PORT` (default 3001) and **fails hard** on EADDRINUSE:
- No auto-shift, no tryListen fallback
- EADDRINUSE → print clear error + `process.exit(1)`
- Fix: kill conflicting process, then restart watchdog

`gateway.mjs` uses `WATCHDOG_PORT` env directly — no file resolution.

Previously had `tryListen(port, attempt)` with auto port-shift + `/tmp/watchdog-actual-port.txt` file — REMOVED in stabilization freeze.

## dev.mjs — Crash Restart (after stabilization freeze)

Standby mode (TCP probe + 5-min wait) was REMOVED. Now: crash → restart in 30s unconditionally.
If root `API Server` and artifact `api-server` both try port 8080, use `kill-port.mjs 8080` and restart root manually.

## DB tables (created by watchdog on startup, idempotent)

- `service_registry` — dynamic service list with URL, health_path, weight, dependencies (JSONB), is_frontend, is_active
- `service_circuit_states` — CB state (CLOSED/OPEN/HALF_OPEN), failure_count, opened_at — persisted every 15s or on transition

## Control plane API (all via gateway at /system/control/*)

- `GET  /control/state` — full state dump
- `GET  /control/registry` — service registry
- `PUT  /control/registry/:service` — update service registry at runtime
- `POST /control/open-circuit  {service}` — force open CB
- `POST /control/close-circuit {service}` — force close CB
- `POST /control/restart-service {service}` — write signal file to /tmp/watchdog/<id>.restart (no spawn)

## Co-locating watchdog in the Gateway workflow (no free workflow slot)

When the 10-workflow cap leaves no slot for a dedicated watchdog workflow, launch it from inside the Gateway workflow's shell script as an independent background process — but do NOT `wait -n gatewayPid watchdogPid` with a shared EXIT trap. That makes either process's death kill both (fail-fast coupling): a watchdog crash takes down the data-plane Gateway too.

**Why:** watchdog (control plane) and gateway (data plane) have different availability requirements — gateway must survive watchdog restarts/crashes.

**How to apply:** run the watchdog in a self-respawning `while true; do node system-watchdog-service.mjs; sleep N; done &` subshell loop, and `wait` only on the gateway PID. Gateway's lifetime is what the workflow tracks; watchdog restarts silently in the background.

## InvoiceOCR-style rate limiting: keep pre-auth limiter separate from per-user/company limiters

When adding rate limiting to an authenticated route, don't stack a per-user/per-company limiter before the auth check — anonymous traffic sharing an IP with legitimate users would burn through the per-user/company budget before auth ever runs, blocking real users behind the same NAT/office IP.

**Why:** found during RC3 code review — original implementation ran all three OCR limiters (IP/user/company) before `requireClerkUser`, letting unauthenticated bursts exhaust the per-user bucket for everyone on that IP.

**How to apply:** put a generous pre-auth IP-only limiter (abuse/bot guard) first, then the auth middleware, then tighter per-user/per-company limiters after — so the latter only ever key on real authenticated identities.

## Supported Replit workflow ports

Replit's `waitForPort` only supports: 3000, 3001, 3002, 3003, 4200, 5000, 5173, 6000, 6800, 8000, 8008, 8080, 8099, 9000.
