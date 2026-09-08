#!/bin/bash
# Start logistic-order dev server.
# Handles two modes:
#   Artifact mode  — no LOGISTIC_ORDER_PORT set; owns port 19368 directly via Vite.
#   Legacy Gateway — LOGISTIC_ORDER_PORT=19368 passed; waits for artifact workflow, then yields.
cd "$(dirname "$0")"

GW_PORT=${LOGISTIC_ORDER_PORT:-19368}

check_port() {
  node -e "const net=require('net');const s=net.connect($1,'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1))" 2>/dev/null
}

# Legacy Gateway path: wait up to 40s for the artifact workflow, then yield.
if [ -n "${LOGISTIC_ORDER_PORT+x}" ]; then
  echo "[logistic-order-legacy] Waiting for artifact workflow to start on port ${GW_PORT}..."
  for i in $(seq 1 40); do
    if check_port "${GW_PORT}"; then
      echo "[logistic-order-legacy] Artifact workflow running on port ${GW_PORT} — yielding"
      exec tail -f /dev/null
    fi
    sleep 1
  done
  echo "[logistic-order-legacy] Fallback: artifact did not start, taking port ${GW_PORT}"
fi

# Artifact mode: if another instance already holds the port, yield and register the port
# so Replit's preview pane can find it.
if check_port "${GW_PORT}"; then
  echo "[logistic-order] Port ${GW_PORT} already in use — yielding to existing instance"
  echo "[PORT CHECK] PID=$$ PORT=${GW_PORT} SERVICE=logistic-order"
  exec tail -f /dev/null
fi

node "../api-server/kill-port.mjs" "${GW_PORT}" 2>/dev/null || true
sleep 0.3

echo "[PORT CHECK] PID=$$ PORT=${GW_PORT} SERVICE=logistic-order"
exec node node_modules/vite/bin/vite.js --config vite.config.ts --host 0.0.0.0 --port "${GW_PORT}"
