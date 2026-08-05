#!/bin/bash
# build-prod-portal.sh — Artifact-level production build untuk customer-portal.
# Dipanggil oleh artifact.toml [services.production] build command.
# Menjamin VITE_SUPABASE_URL dan secrets lain ter-inject dari GCP sebelum vite build.
set -eo pipefail
cd "$(dirname "$0")"

echo "[build-prod-portal] Validating translations..."
node scripts/validate-translations.mjs

echo "[build-prod-portal] Building with production secrets..."
APP_ENV=production node "../api-server/load-secrets.mjs" \
  pnpm exec vite build --config vite.config.ts

echo "[build-prod-portal] Prerendering static routes..."
node scripts/prerender.mjs

echo "[build-prod-portal] Done ✓"
