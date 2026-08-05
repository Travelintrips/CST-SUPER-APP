#!/usr/bin/env bash
# Runtime verification gate.
#
# Dedicated test/staging remains preferred. The owner-approved fallback is the
# standalone SAFE DEV harness, which never boots the API or external workers.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== CST SUPER APP — CUSTOMER RUNTIME GATE ==="
node scripts/release-summary.mjs runtime RUNNING "Runtime gate is running"
if [[ -n "${TEST_DATABASE_URL:-}" || -n "${STAGING_DATABASE_URL:-}" ]]; then
  echo "[runtime] Dedicated test/staging target detected"
  node scripts/runtime-db-guard.mjs --require-app-secrets
  cat >&2 <<'EOF'
[runtime] BLOCKED: the dedicated-target adapter is not yet wired to the full
business E2E suite. Production remains NO-GO until that suite is complete.
EOF
  node scripts/release-summary.mjs runtime FAIL "Dedicated-target adapter is not wired to the full business E2E suite"
  exit 2
fi

echo "[runtime] No dedicated target configured; using owner-approved SAFE DEV TEST MODE"
if SAFE_DEV_TEST_MODE=true node scripts/runtime-safe-dev-test.mjs; then
  node scripts/release-summary.mjs runtime PASS
else
  node scripts/release-summary.mjs runtime FAIL "SAFE DEV runtime gate failed"
  exit 1
fi