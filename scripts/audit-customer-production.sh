#!/usr/bin/env bash
# Production release gate.
#
# GO requires ALL of the following:
#   1. Static gate PASS (builds + typechecks + 886/886 tests)
#   2. Runtime SAFE DEV gate PASS (12/12 DB-level checks)
#   3. Secret rotation verified (audit:secrets exit 0)
#   4. Dedicated staging/test target OR acknowledged BLOCKED state
#   5. Full HTTP E2E PASS (or BLOCKED with explicit acknowledgement)
#
# SAFE DEV harness alone is never sufficient for production GO.
#
# summary.json is written atomically after each sub-gate.
set -uo pipefail

cd "$(dirname "$0")/.."

echo "=== CST SUPER APP — CUSTOMER PRODUCTION GATE ==="
node scripts/release-summary.mjs production RUNNING "Production gate is running"

reasons=()
all_pass=true

# ── 1. Static gate ────────────────────────────────────────────────────────────

set +e
pnpm run audit:customer-static
static_exit=$?
set -e

echo "[production] static gate exit code: ${static_exit}"
if [[ "$static_exit" -ne 0 ]]; then
  reasons+=("Static gate failed (exit ${static_exit})")
  all_pass=false
fi

# ── 2. Runtime SAFE DEV gate ──────────────────────────────────────────────────

runtime_output="$(mktemp)"
set +e
pnpm run audit:customer-runtime 2>&1 | tee "$runtime_output"
runtime_exit=$?
set -e

echo "[production] runtime gate exit code: ${runtime_exit}"
if [[ "$runtime_exit" -ne 0 ]]; then
  reasons+=("Runtime gate failed or was blocked (exit ${runtime_exit})")
  all_pass=false
fi

# Capture SAFE DEV mode flag
runtime_was_safe_dev=false
if grep -q "SAFE DEV TEST MODE" "$runtime_output" 2>/dev/null; then
  runtime_was_safe_dev=true
  node scripts/release-summary.mjs runtimeSafeDev PASS
  echo "[production] runtime evidence: SAFE DEV TEST MODE (not sufficient for production GO)"
else
  node scripts/release-summary.mjs runtimeSafeDev FAIL "Runtime did not complete SAFE DEV checks"
fi
rm -f "$runtime_output"

# ── 3a. Secret availability (presence + format) ────────────────────────────────

echo ""
echo "[production] Checking secret availability..."
set +e
node scripts/validate-secret-rotation.mjs
secret_availability_exit=$?
set -e

echo "[production] secret availability exit code: ${secret_availability_exit}"
if [[ "$secret_availability_exit" -eq 0 ]]; then
  node scripts/release-summary.mjs secretAvailability PASS
  echo "[production] secret availability: PASS"
else
  node scripts/release-summary.mjs secretAvailability FAIL "Required secrets missing or contain placeholder values"
  reasons+=("Secret availability FAIL — required secrets missing or invalid (run: pnpm run audit:secrets)")
  all_pass=false
fi

# ── 3b. Secret rotation (manual verification by account owner) ─────────────────

echo ""
echo "[production] Checking secret rotation verification..."
set +e
node scripts/check-secret-rotation-status.mjs
secret_rotation_exit=$?
set -e

echo "[production] secret rotation exit code: ${secret_rotation_exit}"
if [[ "$secret_rotation_exit" -eq 0 ]]; then
  node scripts/release-summary.mjs secretRotation PASS
  echo "[production] secret rotation: PASS"
else
  node scripts/release-summary.mjs secretRotation INCOMPLETE "Manual rotation verification incomplete — see docs/security/secret-rotation-status.json"
  reasons+=("Secret rotation has not been manually verified — see docs/security/secret-rotation-status.json")
  all_pass=false
fi

# ── 4. Full HTTP E2E ──────────────────────────────────────────────────────────

echo ""
echo "[production] Checking HTTP E2E..."
set +e
node scripts/customer-full-http-e2e.mjs
e2e_exit=$?
set -e

echo "[production] HTTP E2E exit code: ${e2e_exit}"
if [[ "$e2e_exit" -eq 0 ]]; then
  node scripts/release-summary.mjs httpE2E PASS
  node scripts/release-summary.mjs tenantIsolation PASS
  node scripts/release-summary.mjs security PASS
  node scripts/release-summary.mjs cleanup PASS
  echo "[production] HTTP E2E: PASS"
elif [[ "$e2e_exit" -eq 2 ]]; then
  # BLOCKED — no dedicated staging target
  node scripts/release-summary.mjs httpE2E BLOCKED "No dedicated staging/test target configured (TEST_DATABASE_URL or STAGING_DATABASE_URL required)"
  reasons+=("Full HTTP E2E BLOCKED — dedicated staging/test target not configured")
  all_pass=false
  echo "[production] HTTP E2E: BLOCKED (no dedicated target)"
else
  node scripts/release-summary.mjs httpE2E FAIL "HTTP E2E failed (exit ${e2e_exit})"
  reasons+=("Full HTTP E2E failed (exit ${e2e_exit})")
  all_pass=false
  echo "[production] HTTP E2E: FAIL"
fi

# ── Final verdict ─────────────────────────────────────────────────────────────

echo ""
echo "[production] static_exit=${static_exit} runtime_exit=${runtime_exit} availability_exit=${secret_availability_exit} rotation_exit=${secret_rotation_exit} e2e_exit=${e2e_exit}"

# SAFE DEV alone never enough for GO, even if all other gates pass
if "$runtime_was_safe_dev" && [[ "$e2e_exit" -ne 0 ]]; then
  reasons+=("Runtime evidence is SAFE DEV only — full HTTP E2E against a dedicated target is required for GO")
fi

if [[ "${#reasons[@]}" -gt 0 ]]; then
  node scripts/release-summary.mjs production NO-GO "${reasons[@]}"
  echo "[production] NO-GO — ${#reasons[@]} blocker(s):"
  for r in "${reasons[@]}"; do
    echo "   • $r"
  done
  exit 1
fi

node scripts/release-summary.mjs production GO
echo "[production] GO"
