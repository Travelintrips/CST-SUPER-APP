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

GW_PORT=${BIZPORTAL_PORT:-${PORT:-6800}}
# The legacy Gateway fallback passes BIZPORTAL_PORT=18442. Keep the proxy on
# that port, but run Vite on a separate internal port; otherwise the fallback
# tries to bind the proxy and Vite to the same socket and BizPortal stays down.
if { [ -n "${BIZPORTAL_PORT+x}" ] || [ -n "${PORT+x}" ]; } && [ -z "${BIZPORTAL_VITE_PORT+x}" ]; then
  VITE_PORT=18443
else
  VITE_PORT=${BIZPORTAL_VITE_PORT:-18442}
fi

check_port() {
  node -e "const net=require('net');const s=net.connect($1,'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1))" 2>/dev/null
}

# If BIZPORTAL_PORT is set and the port is already bound by another process, yield.
# Do NOT wait for a port to appear — if it's free, own it immediately.
if [ -n "${BIZPORTAL_PORT+x}" ]; then
  if check_port "${GW_PORT}"; then
    echo "[bizportal-legacy] Port ${GW_PORT} already bound — yielding to existing process"
    exec tail -f /dev/null
  fi
fi

# Artifact mode: if port is already bound (another instance is running), yield gracefully.
# Still emit PORT CHECK so Replit's platform associates this port with the artifact workflow
# and the preview pane can display it correctly.
if check_port "${GW_PORT}"; then
  echo "[bizportal] Port ${GW_PORT} already in use — yielding to existing instance"
  echo "[PORT CHECK] PID=$$ PORT=${GW_PORT} SERVICE=bizportal-proxy"
  exec tail -f /dev/null
fi

node "../api-server/kill-port.mjs" "${VITE_PORT}" "${GW_PORT}" 2>/dev/null || true
sleep 0.3

export PORT=$VITE_PORT
export BASE_PATH=${BASE_PATH:-/bizportal/}

# Start HTTP proxy on GW_PORT → VITE_PORT so the Gateway can reach BizPortal
node -e "
const http = require('http');
const GW = $GW_PORT;
const UP = $VITE_PORT;
function tryProxy(req, res) {
  let retries = 0;
  function attempt() {
    const opts = { hostname: '127.0.0.1', port: UP, path: req.url, method: req.method, headers: req.headers };
    const p = http.request(opts, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res, {end:true}); });
    p.on('error', () => { if (++retries < 60) { setTimeout(attempt, 300); } else { res.writeHead(502); res.end('BizPortal starting...'); } });
    req.pipe(p, {end:true});
  }
  attempt();
}
http.createServer(tryProxy).listen(GW, '0.0.0.0', () => {
  console.log('[PORT CHECK] PID=' + process.pid + ' PORT=' + GW + ' SERVICE=bizportal-proxy');
  console.log('[bizportal] proxy :' + GW + ' -> :' + UP);
  process.stdout.write('PROXY_READY\n');
});
setInterval(() => {}, 1000);
" &
PROXY_PID=$!

# Wait for proxy to be listening
timeout 10 bash -c "while ! node -e \"const net=require('net');const s=net.connect($GW_PORT,'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1))\" 2>/dev/null; do sleep 0.2; done"

# Echo PORT CHECK from foreground so Replit platform detects port 6800
echo "[PORT CHECK] PID=$PROXY_PID PORT=$GW_PORT SERVICE=bizportal-proxy"

# Start Vite (NOT with exec so proxy keeps running alongside it)
APP_ENV=${APP_ENV:-development} NODE_ENV=development API_PORT=${API_PORT:-18444} \
  node ../api-server/load-secrets.mjs node node_modules/vite/bin/vite.js \
  --config vite.config.ts --host 0.0.0.0 --port "${VITE_PORT}"

# If vite exits, also kill the proxy
kill $PROXY_PID 2>/dev/null
