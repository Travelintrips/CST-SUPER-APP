#!/usr/bin/env bash
# Static release gate. This script must never turn a failed check into a pass.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== CST SUPER APP — CUSTOMER STATIC GATE ==="
echo "Node: $(node -v)"
echo "pnpm: $(pnpm -v)"

node scripts/release-summary.mjs static RUNNING "Static gate is running"
node scripts/release-summary.mjs regression NOT_RUN "API regression target has not been verified"
api_test_report=""
api_regression_started=0
trap 'status=$?; if [[ "$status" -eq 0 ]]; then node scripts/release-summary.mjs static PASS; else node scripts/release-summary.mjs static FAIL "Static gate command failed"; fi; if [[ "$api_regression_started" -eq 1 ]]; then if [[ "$status" -eq 0 ]]; then node scripts/release-summary.mjs regression PASS "API regression passed on isolated target"; else node scripts/release-summary.mjs regression FAIL "API regression command failed"; fi; fi; if [[ -n "$api_test_report" ]]; then rm -f "$api_test_report"; fi; exit "$status"' EXIT

echo "[static] Shared library typecheck"
pnpm run typecheck:libs

echo "[static] Customer Portal typecheck"
pnpm --filter @workspace/customer-portal typecheck

echo "[static] BizPortal typecheck"
pnpm --filter @workspace/bizportal typecheck

echo "[static] API Server typecheck"
pnpm --filter @workspace/api-server typecheck

echo "[static] API Server unit tests"
if [[ -z "${TEST_DATABASE_URL:-}" && -z "${STAGING_DATABASE_URL:-}" ]]; then
  node scripts/release-summary.mjs regression BLOCKED "Set TEST_DATABASE_URL or STAGING_DATABASE_URL; shared DEV/PROD/Helium targets are rejected"
  echo "[static] API regression BLOCKED: isolated staging target is not configured"
  exit 1
fi
api_regression_started=1
node scripts/release-summary.mjs regression RUNNING "API regression is running on an isolated target"
api_test_report="$(mktemp)"
if ! pnpm --filter @workspace/api-server test --run --reporter=json --outputFile="$api_test_report"; then
  echo "[static] API test suite failed"
  exit 1
fi
node - "$api_test_report" <<'NODE'
const fs = require("node:fs");
const reportPath = process.argv[2];
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const totals = {
  total: report.numTotalTests,
  passed: report.numPassedTests,
  failed: report.numFailedTests,
  pending: report.numPendingTests,
  todo: report.numTodoTests,
};
console.log(`[static] API test totals: ${JSON.stringify(totals)}`);
if (
  totals.total <= 0 ||
  totals.passed !== totals.total ||
  totals.failed !== 0 ||
  totals.pending !== 0 ||
  totals.todo !== 0
) {
  console.error("[static] FAIL: API suite must have tests, all passing, with 0 failed/pending/todo");
  process.exit(1);
}
NODE

echo "[static] Customer Portal build"
pnpm --filter @workspace/customer-portal build

echo "[static] BizPortal build"
pnpm --filter @workspace/bizportal build

echo "[static] API Server build"
pnpm --filter @workspace/api-server build

echo "[static] PASS"