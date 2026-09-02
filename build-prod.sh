#!/bin/bash
# build-prod.sh — Production build script for Replit deployment.
#
# Berbeda dari dev build: VITE_SUPABASE_URL dan secrets lain harus
# di-inject dari GCP Secret Manager (production keys) sebelum vite build
# supaya env vars ter-bake ke dalam JS bundle dengan nilai yang benar.
#
# Urutan build:
#   1. API Server  (load-secrets.mjs bergantung pada node_modules api-server)
#   2. Customer Portal  (VITE_SUPABASE_URL wajib di-bake via load-secrets)
#   3. BizPortal        (VITE_SUPABASE_URL wajib di-bake via load-secrets)

set -eo pipefail
cd "$(dirname "$0")"

LOAD_SECRETS="artifacts/api-server/load-secrets.mjs"

echo "[build-prod] === Production Build Start ==="

# ── 1. API Server ──────────────────────────────────────────────────────────────
echo "[build-prod] Building API Server..."
pnpm --filter @workspace/api-server run build
echo "[build-prod] API Server ✓"

# ── 2. Customer Portal ─────────────────────────────────────────────────────────
# validate-translations must pass before vite build (build script includes it).
# We split the steps manually so load-secrets wraps only the vite build.
echo "[build-prod] Customer Portal: validating translations..."
cd artifacts/customer-portal
node scripts/validate-translations.mjs

echo "[build-prod] Customer Portal: building with production secrets..."
APP_ENV=production node "../api-server/load-secrets.mjs" \
  pnpm exec vite build --config vite.config.ts

echo "[build-prod] Customer Portal: prerendering static routes..."
node scripts/prerender.mjs
cd ../..
echo "[build-prod] Customer Portal ✓"

# ── 3. BizPortal ──────────────────────────────────────────────────────────────
echo "[build-prod] BizPortal: building with production secrets..."
cd artifacts/bizportal
APP_ENV=production node "../api-server/load-secrets.mjs" \
  pnpm exec vite build --config vite.config.ts
cd ../..
echo "[build-prod] BizPortal ✓"

# ── 4. Deployment artifact validation ─────────────────────────────────────────
# Fail closed instead of allowing pnpm filters with no matching project to
# produce a successful publishing build with missing runtime assets.
echo "[build-prod] Validating deployment artifacts..."
for required_file in \
  "artifacts/api-server/dist/index.mjs" \
  "artifacts/customer-portal/dist/public/index.html" \
  "artifacts/bizportal/dist/public/index.html"
do
  if [ ! -s "$required_file" ]; then
    echo "[build-prod] ERROR: required artifact missing or empty: $required_file" >&2
    exit 1
  fi
done
echo "[build-prod] Deployment artifacts ✓"

echo "[build-prod] === All artifacts built successfully ==="
