#!/bin/bash
cd "$(dirname "$0")"

# Artifact workflows can start with a minimal PATH. Resolve node explicitly.
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  for candidate in /nix/store/*-nodejs-22.*-wrapped/bin/node /nix/store/*-nodejs-22.*/bin/node /nix/store/*-nodejs-20.*-wrapped/bin/node /nix/store/*-nodejs-20.*/bin/node; do
    if [ -x "$candidate" ]; then
      NODE_BIN="$candidate"
      break
    fi
  done
fi
if [ -n "$NODE_BIN" ]; then
  export PATH="$(dirname "$NODE_BIN"):$PATH"
fi

GW_PORT=${CUSTOMER_PORT:-${PORT:-23434}}
VITE_PORT=${CUSTOMER_VITE_PORT:-23435}

check_port() {
  node -e "const net=require('net');const s=net.connect($1,'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1))" 2>/dev/null
}

# If CUSTOMER_PORT is set and the port is already bound by another process, yield.
# Do NOT wait for a port to appear — if it's free, own it immediately.
if [ -n "${CUSTOMER_PORT+x}" ]; then
  if check_port "${GW_PORT}"; then
    echo "[customer-portal-legacy] Port ${GW_PORT} already bound — yielding to existing process"
    exec tail -f /dev/null
  fi
fi

# Artifact mode: if port is already bound (another instance is running), yield gracefully.
if check_port "${GW_PORT}"; then
  echo "[customer-portal] Port ${GW_PORT} already in use — yielding to existing instance"
  exec tail -f /dev/null
fi

node "../api-server/kill-port.mjs" "${VITE_PORT}" "${GW_PORT}" 2>/dev/null || true
sleep 0.3

export PORT=$VITE_PORT
export BASE_PATH=${BASE_PATH:-/}

# Start HTTP proxy on GW_PORT → VITE_PORT so the Gateway can reach Customer Portal
node -e "
const http = require('http');
const net  = require('net');
const GW = $GW_PORT;
const UP = $VITE_PORT;
function tryProxy(req, res) {
  let retries = 0;
  function attempt() {
    const opts = { hostname: '127.0.0.1', port: UP, path: req.url, method: req.method, headers: req.headers };
    const p = http.request(opts, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res, {end:true}); });
    p.on('error', () => { if (++retries < 60) { setTimeout(attempt, 300); } else { res.writeHead(502); res.end('Customer Portal starting...'); } });
    req.pipe(p, {end:true});
  }
  attempt();
}
const server = http.createServer(tryProxy);
server.on('upgrade', (req, socket, head) => {
  const tunnel = net.connect(UP, '127.0.0.1');
  tunnel.on('connect', () => {
    tunnel.write(req.method + ' ' + req.url + ' HTTP/1.1\r\n' +
      Object.entries(req.headers).map(([k,v]) => k+': '+v).join('\r\n') + '\r\n\r\n');
    if (head && head.length) tunnel.write(head);
    tunnel.pipe(socket, {end:true});
    socket.on('error', () => tunnel.destroy());
    tunnel.on('error', () => socket.destroy());
  });
  tunnel.on('error', () => socket.destroy());
});
server.listen(GW, '0.0.0.0', () => {
  console.log('[PORT CHECK] PID=' + process.pid + ' PORT=' + GW + ' SERVICE=customer-portal-proxy');
  console.log('[customer-portal] proxy :' + GW + ' -> :' + UP);
  process.stdout.write('PROXY_READY\n');
});
setInterval(() => {}, 1000);
" &
PROXY_PID=$!

# Wait for proxy to be listening
timeout 10 bash -c "while ! node -e \"const net=require('net');const s=net.connect($GW_PORT,'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1))\" 2>/dev/null; do sleep 0.2; done"

# Echo PORT CHECK from foreground so Replit platform detects port 23434
echo "[PORT CHECK] PID=$PROXY_PID PORT=$GW_PORT SERVICE=customer-portal-proxy"

# Start Vite (NOT with exec so proxy keeps running alongside it)
APP_ENV=${APP_ENV:-development} NODE_ENV=development \
  node ../api-server/load-secrets.mjs node node_modules/vite/bin/vite.js \
  --config vite.config.ts --host 0.0.0.0 --port "${VITE_PORT}"

# If vite exits, also kill the proxy
kill $PROXY_PID 2>/dev/null
