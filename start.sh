#!/bin/bash
# Production entrypoint for Replit Autoscale/Cloud Run.
# The API process serves the prebuilt Customer Portal, BizPortal, and Logistic
# Order static bundles, so production needs exactly one HTTP listener.
set -euo pipefail
cd "$(dirname "$0")/artifacts/api-server"

export APP_ENV=production
export NODE_ENV=production
export REPLIT_DEPLOYMENT="${REPLIT_DEPLOYMENT:-1}"
export PORT="${PORT:-8080}"

exec node load-secrets.mjs \
  node --enable-source-maps ./dist/index.mjs
