#!/bin/bash
# NOTE: do NOT add set -e here — subshell failures (lib/db build) are non-fatal
cd "$(dirname "$0")"

# Artifact workflows can start with a minimal PATH. Resolve the workspace's
# Node 20 runtime explicitly so both node and pnpm are available below.
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  for candidate in /nix/store/*-nodejs-20.*-wrapped/bin/node /nix/store/*-nodejs-20.*/bin/node; do
    if [ -x "$candidate" ]; then
      NODE_BIN="$candidate"
      break
    fi
  done
fi
if [ -n "$NODE_BIN" ]; then
  export PATH="$(dirname "$NODE_BIN"):/home/runner/workspace/.config/npm/node_global/bin:$PATH"
else
  echo "[start-dev] Node.js 20 tidak ditemukan di PATH atau /nix/store"
fi

# Artifact workflows may not expose pnpm on PATH even though the package
# manager is installed globally. Resolve it explicitly for the lib/db build.
PNPM_BIN="/home/runner/workspace/.config/npm/node_global/bin/pnpm"
if [ ! -x "$PNPM_BIN" ]; then
  PNPM_BIN="$(command -v pnpm || true)"
fi

# ── Environment ──────────────────────────────────────────────────────────────
# start-dev.sh is ONLY called in development artifact workflows — never during a
# real deployment (which uses start.sh or the Gateway with REPLIT_DEPLOYMENT=1).
# Force APP_ENV=development unconditionally so that if the Replit workspace has
# APP_ENV=production as a persisted env var, it does NOT bleed into dev runs and
# cause lib/db to connect to the production Supabase project.
APP_ENV=development
export APP_ENV

# ── Deterministic single-listener configuration ─────────────────────────────
# The artifact workflow exposes 18444. Express binds directly to that port;
# there is no second forwarder listener and no hidden 18445 process.
API_PORT=${API_PORT:-18444}
export API_PORT

# Only one API workflow instance may own the forwarder and internal server.
# A second artifact/workflow invocation stays alive without binding anything,
# preventing an EADDRINUSE crash loop while the first instance is healthy.
exec 9>/tmp/cst-api-server-dev.lock
if ! flock -n 9; then
  echo "[start-dev] Another API workflow instance owns the lock; yielding"
  exec tail -f /dev/null
fi

check_port() {
  node -e "const net=require('net');const s=net.connect($1,'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1))" 2>/dev/null
}

# Yield if API port is already bound by another instance
if check_port "$API_PORT"; then
  echo "[start-dev] Port $API_PORT already in use — yielding to existing instance"
  exec tail -f /dev/null
fi

# Build lib/db so dist/index.d.ts is always fresh before TypeScript compilation
echo "[start-dev] Building lib/db..."
if [ -n "$PNPM_BIN" ]; then
  (cd ../../lib/db && "$PNPM_BIN" exec tsc -p tsconfig.json 2>&1 | tail -5) && echo "[start-dev] lib/db OK" || echo "[start-dev] lib/db build warning (non-fatal)"
else
  echo "[start-dev] pnpm tidak ditemukan — melewati build lib/db (non-fatal)"
fi

# Kill stale processes on the API port before binding.
node kill-port.mjs "$API_PORT" 2>/dev/null || true
sleep 0.3

# Start watch-mode dev server (esbuild watch + auto-restart on rebuild)
PORT=$API_PORT node dev.mjs &
DEV_PID=$!

echo "[start-dev] dev watcher PID=$DEV_PID (single API listener on :$API_PORT)"

# Trap SIGTERM/SIGINT and forward to the watcher.
trap "kill $DEV_PID 2>/dev/null; exit 0" TERM INT

# Wait for the dev watcher (the sole API process).
wait $DEV_PID
