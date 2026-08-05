#!/bin/bash
# Production startup script for CST Super App
# Starts all 5 services in parallel, then exec's the Gateway on port 5000.
#
# Service topology:
#   Gateway        :5000  — main entry point (reverse proxy)
#   API Server     :18444 — Express REST API (loaded with GCP secrets)
#   BizPortal      :6800  — Business admin SPA (vite preview)
#   Customer Portal:23434 — Public marketplace SPA (vite preview)
#   Logistic Order :19368 — Logistics management SPA (vite preview)

set -e
cd "$(dirname "$0")"

export APP_ENV=production
export NODE_ENV=production
export API_PORT=18444
export BIZPORTAL_PORT=6800
export CUSTOMER_PORT=23434
export LOGISTIC_ORDER_PORT=19368

echo "[start-prod] Starting CST Super App (production)..."

# ── API Server ─────────────────────────────────────────────────────────────
# load-secrets.mjs fetches GCP Secret Manager secrets and injects them into
# process.env before starting the Express server.
echo "[start-prod] API Server  :$API_PORT"
(cd artifacts/api-server && PORT=$API_PORT node load-secrets.mjs node --enable-source-maps ./dist/index.mjs) &

# ── Frontend SPA services (vite preview — serves pre-built dist/) ──────────
echo "[start-prod] BizPortal   :$BIZPORTAL_PORT"
(PORT=$BIZPORTAL_PORT pnpm --filter @workspace/bizportal run serve) &

echo "[start-prod] Customer Portal :$CUSTOMER_PORT"
(PORT=$CUSTOMER_PORT pnpm --filter @workspace/customer-portal run serve) &

echo "[start-prod] Logistic Order  :$LOGISTIC_ORDER_PORT"
(PORT=$LOGISTIC_ORDER_PORT pnpm --filter @workspace/logistic-order run serve) &

# ── Gateway ────────────────────────────────────────────────────────────────
# exec replaces this shell so SIGTERM from Replit propagates to the gateway.
echo "[start-prod] Gateway     :5000"
exec node gateway.mjs
