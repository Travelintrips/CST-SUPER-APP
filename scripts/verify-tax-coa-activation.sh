#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_BUNDLE="$ROOT_DIR/artifacts/api-server/.tmp-verify-tax-coa-activation.mjs"

cleanup() {
  rm -f "$TMP_BUNDLE"
}
trap cleanup EXIT

pnpm exec esbuild \
  "$ROOT_DIR/scripts/src/verify-tax-coa-activation.mjs" \
  --bundle \
  --platform=node \
  --format=esm \
  --packages=bundle \
  --external:pg \
  --external:pino \
  --external:pino-pretty \
  --external:thread-stream \
  --external:ws \
  --outfile="$TMP_BUNDLE" >/dev/null

APP_ENV="${APP_ENV:-development}"
if [[ "$APP_ENV" == "production" ]]; then
  NODE_ENV=production node "$ROOT_DIR/artifacts/api-server/load-secrets.mjs" node "$TMP_BUNDLE" "$@"
else
  NODE_ENV=development node "$ROOT_DIR/artifacts/api-server/load-secrets.mjs" node "$TMP_BUNDLE" "$@"
fi