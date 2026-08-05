#!/bin/bash
# Gateway startup script.
# Jika artifact workflows sudah aktif di port mereka, Gateway menunggu saja.
# Jika belum (fresh boot tanpa artifact workflows), Gateway spawn sendiri.
# Ini mencegah EADDRINUSE crash-loop saat kedua mode berjalan bersamaan.

# ── Cold-start guard: install missing deps before anything else ──────────
# Runs fast (< 1s) when deps are present; only triggers pnpm install on a
# fresh import or after Replit cleans the workspace.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$SCRIPT_DIR/scripts/ensure-deps.sh" ]]; then
  bash "$SCRIPT_DIR/scripts/ensure-deps.sh" || echo "[start] ensure-deps warning (non-fatal)"
fi

# Prevent duplicate Gateway workflow instances from racing over port 5000.
exec 8>/tmp/cst-gateway.lock
if ! flock -n 8; then
  echo "[start] Another Gateway workflow instance owns the lock — yielding"
  exec tail -f /dev/null
fi

# Kill Gateway port di startup
node artifacts/api-server/kill-port.mjs 5000 2>/dev/null || true
sleep 0.5

export PORT=5000
export API_PORT=18444
export BIZPORTAL_PORT=18442
export BIZPORTAL_VITE_PORT=18449
export CUSTOMER_PORT=23434
export LOGISTIC_ORDER_PORT=19368

trap "kill 0 2>/dev/null; exit" TERM INT EXIT

# ── Port helpers ───────────────────────────────────────────────────────────
check_port() {
  node -e "const net=require('net');const s=net.connect($1,'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1))" 2>/dev/null
}

wait_for_port() {
  local port=$1 name=$2 timeout=${3:-60}
  for i in $(seq 1 $timeout); do
    if check_port "$port"; then
      echo "[start] $name ready on :$port"
      return 0
    fi
    sleep 1
  done
  echo "[start] WARNING: $name did not come up on :$port within ${timeout}s — Gateway will retry upstream requests"
}

# ── Spawn a service with restart-on-exit loop (if port is not already bound) ──
# Usage: spawn_with_restart <port> <name> <cmd...>
#
# If the port is already bound (artifact workflow is running it), we skip
# spawning entirely — no restart loop is needed.
#
# If we own the process we run it in a supervisor loop with exponential
# backoff (2 → 4 → 8 → … → 30 s cap).  The backoff resets whenever the
# service stays alive for at least 10 seconds, which means a healthy service
# that crashes once gets an almost-immediate restart.
spawn_with_restart() {
  local port=$1 name=$2
  shift 2
  if check_port "$port"; then
    echo "[start] $name already up on :$port (artifact workflow) — skip spawn"
    return
  fi
  echo "[start] $name not running — spawning with restart supervisor..."
  (
    local backoff=2
    while true; do
      local t_start=$SECONDS
      "$@" 2>&1 | sed "s/^/[$name] /"
      local exit_code=${PIPESTATUS[0]}
      local ran_for=$(( SECONDS - t_start ))
      if [ $ran_for -ge 10 ]; then
        # Service was healthy for a while; reset backoff
        backoff=2
      fi
      echo "[start] $name exited (code=$exit_code, ran=${ran_for}s) — respawning in ${backoff}s" >&2
      sleep $backoff
      backoff=$(( backoff * 2 > 30 ? 30 : backoff * 2 ))
    done
  ) &
}

echo "[start] Gateway on :5000 — checking upstream services..."

spawn_with_restart 18444 "api-server" pnpm --filter @workspace/api-server run dev:secure
spawn_with_restart 18442 "bizportal"  env PORT=18442 BASE_PATH=/bizportal/ pnpm --filter @workspace/bizportal run dev
spawn_with_restart 23434 "customer-portal" env PORT=23434 BASE_PATH=/ pnpm --filter @workspace/customer-portal run dev
spawn_with_restart 19368 "logistic-order" env PORT=19368 BASE_PATH=/logistic-order/ pnpm --filter @workspace/logistic-order run dev

# ── Tunggu API Server sehat sebelum lanjut ────────────────────────────────
wait_for_api_healthy() {
  local timeout=120
  echo "[start] Waiting for API Server on :18444..."
  for i in $(seq 1 $timeout); do
    if check_port "18444"; then
      local status
      status=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:18444/api/health/ready" 2>/dev/null)
      if [ "$status" = "200" ]; then
        echo "[start] API Server is healthy (HTTP $status) — proceeding"
        return 0
      fi
    fi
    sleep 1
  done
  echo "[start] WARNING: API Server did not become healthy within ${timeout}s — Gateway starting anyway"
}
wait_for_api_healthy

wait_for_port 18442 "BizPortal" 30 &
wait_for_port 23434 "Customer Portal" 30 &
wait_for_port 19368 "Logistic Order" 30 &

# ── Watchdog (control plane) ───────────────────────────────────────────────
export WATCHDOG_PORT=3001
node artifacts/api-server/kill-port.mjs 3001 2>/dev/null || true

(
  while true; do
    node system-watchdog-service.mjs
    echo "[start] Watchdog exited — respawning in 2s" >&2
    sleep 2
  done
) &
WD_LOOP_PID=$!
echo "[start] Watchdog supervisor loop PID=$WD_LOOP_PID (service on :3001)"

node gateway.mjs &
GW_PID=$!

wait $GW_PID
