#!/bin/bash
# Gateway startup wrapper — matches the PORT CHECK pattern used by artifact workflows
# so Replit's platform correctly detects port 5000.

check_port() {
  node -e "const net=require('net');const s=net.connect($1,'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1))" 2>/dev/null
}

# Kill anything already on port 5000
node artifacts/api-server/kill-port.mjs 5000 2>/dev/null || true
sleep 0.3

# Start gateway in background
PORT=5000 API_PORT=${API_PORT:-18444} BIZPORTAL_PORT=${BIZPORTAL_PORT:-6800} \
  CUSTOMER_PORT=${CUSTOMER_PORT:-23434} LOGISTIC_ORDER_PORT=${LOGISTIC_ORDER_PORT:-19368} \
  node gateway.mjs &
GW_PID=$!

# Wait for gateway to bind port 5000 (up to 15s)
timeout 15 bash -c "while ! node -e \"const net=require('net');const s=net.connect(5000,'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1))\" 2>/dev/null; do sleep 0.2; done"

# Echo PORT CHECK from foreground so Replit platform detects port 5000
echo "[PORT CHECK] PID=$GW_PID PORT=5000 SERVICE=gateway"

# Keep script alive — exit when gateway exits
wait $GW_PID
