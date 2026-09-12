#!/usr/bin/env bash
# HTTP E2E gate wrapper.
#
# Runs the full HTTP E2E harness. If TEST_DATABASE_URL and STAGING_DATABASE_URL
# are both absent the harness exits 2 (BLOCKED) and this gate records the
# reason in summary.json.
#
# Exit codes:
#   0 — HTTP E2E PASS
#   1 — HTTP E2E FAIL
#   2 — BLOCKED (no dedicated test target)
#   3 — BLOCKED (API server unreachable or not in E2E mode)
set -uo pipefail

cd "$(dirname "$0")/.."

echo "=== CST SUPER APP — HTTP E2E GATE ==="

node scripts/release-summary.mjs httpE2E RUNNING "HTTP E2E gate is running"

set +e
node scripts/customer-full-http-e2e.mjs
e2e_exit=$?
set -e

case "$e2e_exit" in
  0)
    node scripts/release-summary.mjs httpE2E PASS
    node scripts/release-summary.mjs tenantIsolation PASS
    node scripts/release-summary.mjs security       PASS
    node scripts/release-summary.mjs accounting     PASS
    node scripts/release-summary.mjs sse            PASS
    node scripts/release-summary.mjs cleanup        PASS
    echo "[http-e2e] PASS"
    exit 0
    ;;
  2)
    node scripts/release-summary.mjs httpE2E BLOCKED \
      "No dedicated test target: set TEST_DATABASE_URL or STAGING_DATABASE_URL"
    echo "[http-e2e] BLOCKED — dedicated staging/test target not configured"
    echo "           Set TEST_DATABASE_URL or STAGING_DATABASE_URL to unblock."
    exit 2
    ;;
  3)
    node scripts/release-summary.mjs httpE2E BLOCKED \
      "API server unreachable or not running in E2E_TEST_MODE"
    echo "[http-e2e] BLOCKED — API server not reachable or not in E2E mode"
    exit 3
    ;;
  *)
    node scripts/release-summary.mjs httpE2E FAIL \
      "HTTP E2E failed with exit code ${e2e_exit}"
    echo "[http-e2e] FAIL (exit ${e2e_exit})"
    exit 1
    ;;
esac
