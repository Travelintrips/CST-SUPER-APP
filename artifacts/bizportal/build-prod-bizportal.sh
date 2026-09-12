#!/bin/bash
# build-prod-bizportal.sh — Artifact-level production build untuk bizportal.
# Dipanggil oleh artifact.toml [services.production] build command.
# Menjamin VITE_SUPABASE_URL dan secrets lain ter-inject dari GCP sebelum vite build.
set -eo pipefail
cd "$(dirname "$0")"

echo "[build-prod-bizportal] Building with production secrets..."
APP_ENV=production node "../api-server/load-secrets.mjs" \
  pnpm exec vite build --config vite.config.ts

echo "[build-prod-bizportal] Done ✓"
