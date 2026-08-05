#!/bin/bash
# Unified single-workflow startup for Replit.
# Starts every sub-service directly on the fixed ports the Gateway expects,
# then execs the Gateway in the foreground so the workflow tracks it.
#
# NOTE: Replit also auto-runs separate per-artifact workflows (e.g.
# "artifacts/bizportal: web") that bind these exact same ports via their own
# start-dev.sh scripts. To avoid EADDRINUSE crashes when both run at once,
# each service below yields (skips starting its own copy) if the port is
# already bound by another instance (the artifact workflow, or a leftover
# process from a previous run).

set -uo pipefail
cd "$(dirname "$0")"

# Replit service workflows may expose a minimal PATH. Resolve Node 20 from
# Nix explicitly so the API loader, gateway, and pnpm-based Vite previews work.
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  for candidate in /nix/store/*-nodejs-20.*-wrapped/bin/node /nix/store/*-nodejs-20.*/bin/node; do
    if [ -x "$candidate" ]; then
      NODE_BIN="$candidate"
      break
    fi
  done
fi
if [ -z "$NODE_BIN" ]; then
  echo "[start] Node.js 20 tidak ditemukan di PATH atau /nix/store" >&2
  exit 1
fi
export PATH="$(dirname "$NODE_BIN"):/home/runner/workspace/.config/npm/node_global/bin:$PATH"

PNPM_BIN="/home/runner/workspace/.config/npm/node_global/bin/pnpm"
if [ ! -x "$PNPM_BIN" ]; then
  PNPM_BIN="$(command -v pnpm || true)"
fi
if [ -z "$PNPM_BIN" ]; then
  echo "[start] pnpm tidak ditemukan di PATH" >&2
  exit 1
fi

API_PORT=8080
BIZPORTAL_PORT=6800
CUSTOMER_PORT=23435
LOGISTIC_ORDER_PORT=19368
GATEWAY_PORT=5000

# The unified Gateway is also the Replit preview entry point. Preview must use
# the development Secret Manager keys and database; only a real deployment may
# select production secrets. Do not hard-code NODE_ENV=production here because
# that makes preview reads and writes hit the production Supabase project.
case "${REPLIT_DEPLOYMENT:-}" in
  1|true|TRUE|yes|YES)
    API_APP_ENV=production
    API_NODE_ENV=production
    ;;
  *)
    API_APP_ENV=development
    API_NODE_ENV=development
    ;;
esac

prepare_preview_bundles() {
  # `vite preview` serves values compiled into dist/, so runtime API mode alone
  # cannot change a stale production Supabase URL in a preview bundle.
  [ "$API_APP_ENV" = "development" ] || return 0

  echo "[start] Building preview bundles with development secrets..."
  (
    cd artifacts/bizportal &&
    APP_ENV=development NODE_ENV=development \
      node ../api-server/load-secrets.mjs "$PNPM_BIN" exec vite build --config vite.config.ts
  ) || {
    echo "[start] BizPortal preview build failed" >&2
    return 1
  }
  (
    cd artifacts/customer-portal &&
    APP_ENV=development NODE_ENV=development \
      node ../api-server/load-secrets.mjs "$PNPM_BIN" exec vite build --config vite.config.ts &&
      node scripts/prerender.mjs
  ) || {
    echo "[start] Customer Portal preview build failed" >&2
    return 1
  }
}

trap 'kill 0 2>/dev/null; exit' TERM INT EXIT

check_port() {
  node -e "const net=require('net');const s=net.connect($1,'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1))" 2>/dev/null
}

start_if_free() {
  local name="$1" port="$2" cmd="$3"
  if check_port "$port"; then
    echo "[start] $name port :$port already in use — yielding to existing instance"
    ( tail -f /dev/null ) &
  else
    echo "[start] $name on :$port..."
    ( eval "$cmd" ) &
  fi
}

start_if_free "API Server" "$API_PORT" \
  "cd artifacts/api-server && PORT=$API_PORT APP_ENV=$API_APP_ENV NODE_ENV=$API_NODE_ENV node load-secrets.mjs node --enable-source-maps dist/index.mjs"

# BizPortal: use vite preview (pre-built dist/) if available, else dev server
if [ "$API_APP_ENV" = "production" ] && [ -f "artifacts/bizportal/dist/public/index.html" ]; then
  echo "[start] BizPortal using pre-built dist/ (vite preview)"
  start_if_free "BizPortal" "$BIZPORTAL_PORT" \
    "cd artifacts/bizportal && PORT=$BIZPORTAL_PORT BASE_PATH=/bizportal/ $PNPM_BIN exec vite preview --config vite.config.ts --host 0.0.0.0 --port $BIZPORTAL_PORT"
else
  echo "[start] BizPortal using development Vite server"
  start_if_free "BizPortal" "$BIZPORTAL_PORT" \
    "cd artifacts/bizportal && APP_ENV=development NODE_ENV=development PORT=$BIZPORTAL_PORT BASE_PATH=/bizportal/ node ../api-server/load-secrets.mjs $PNPM_BIN exec vite --config vite.config.ts --host 0.0.0.0 --port $BIZPORTAL_PORT"
fi

# Customer Portal: use vite preview (pre-built dist/) if available, else dev server
if [ "$API_APP_ENV" = "production" ] && [ -f "artifacts/customer-portal/dist/public/index.html" ]; then
  echo "[start] Customer Portal using pre-built dist/ (vite preview)"
  start_if_free "Customer Portal" "$CUSTOMER_PORT" \
    "cd artifacts/customer-portal && PORT=$CUSTOMER_PORT BASE_PATH=/ $PNPM_BIN exec vite preview --config vite.config.ts --host 0.0.0.0 --port $CUSTOMER_PORT"
else
  echo "[start] Customer Portal using development Vite server"
  start_if_free "Customer Portal" "$CUSTOMER_PORT" \
    "cd artifacts/customer-portal && APP_ENV=development NODE_ENV=development PORT=$CUSTOMER_PORT BASE_PATH=/ node ../api-server/load-secrets.mjs node node_modules/vite/bin/vite.js --config vite.config.ts --host 0.0.0.0 --port $CUSTOMER_PORT"
fi

# Logistic Order: use vite preview (pre-built dist/) if available, else dev server
if [ -f "artifacts/logistic-order/dist/public/index.html" ]; then
  echo "[start] Logistic Order using pre-built dist/ (vite preview)"
  start_if_free "Logistic Order" "$LOGISTIC_ORDER_PORT" \
    "cd artifacts/logistic-order && PORT=$LOGISTIC_ORDER_PORT BASE_PATH=/logistic-order/ $PNPM_BIN exec vite preview --config vite.config.ts --host 0.0.0.0 --port $LOGISTIC_ORDER_PORT"
else
  echo "[start] Logistic Order using dev server (no dist/ found)"
  start_if_free "Logistic Order" "$LOGISTIC_ORDER_PORT" \
    "cd artifacts/logistic-order && PORT=$LOGISTIC_ORDER_PORT BASE_PATH=/logistic-order/ pnpm exec vite --config vite.config.ts --host 0.0.0.0 --port $LOGISTIC_ORDER_PORT"
fi

echo "[start] Gateway on :$GATEWAY_PORT..."
PORT=$GATEWAY_PORT \
API_PORT=$API_PORT \
BIZPORTAL_PORT=$BIZPORTAL_PORT \
CUSTOMER_PORT=$CUSTOMER_PORT \
LOGISTIC_ORDER_PORT=$LOGISTIC_ORDER_PORT \
node gateway.mjs &
GW_PID=$!

wait $GW_PID
