#!/usr/bin/env bash
# smoke-test-prod.sh — Post-deploy smoke test for the live production URL.
#
# Usage:
#   bash scripts/smoke-test-prod.sh <BASE_URL>
#
# Example:
#   bash scripts/smoke-test-prod.sh https://myapp.replit.app
#
# Checks these routes and exits non-zero if any returns an error status:
#   /api/ping          — API server liveness
#   /system/health     — Gateway liveness
#   /bizportal/        — BizPortal frontend
#   /logistic-order/   — Logistic Order frontend
#   /                  — Customer Portal (default route)
#
# Exit codes:
#   0  — all routes healthy
#   1  — one or more routes failed
#
# Run this script after EVERY publish / deployment to confirm the live
# URL is serving requests before telling the team the deploy is successful.

set -uo pipefail

BASE_URL="${1:-}"

if [ -z "$BASE_URL" ]; then
  echo "Usage: bash scripts/smoke-test-prod.sh <BASE_URL>"
  echo "  e.g. bash scripts/smoke-test-prod.sh https://myapp.replit.app"
  exit 1
fi

# Strip trailing slash from base URL
BASE_URL="${BASE_URL%/}"

PASS=0
FAIL=0
RESULTS=()

# Timeout per request (seconds)
TIMEOUT="${SMOKE_TIMEOUT:-15}"

# ── Helper ────────────────────────────────────────────────────────────────────

check_route() {
  local label="$1"
  local path="$2"
  local url="${BASE_URL}${path}"

  # Follow up to 5 redirects (-L), fail on HTTP 4xx/5xx (-f),
  # but capture the final status code regardless.
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time "$TIMEOUT" \
    -L \
    "$url" 2>/dev/null)

  local curl_exit=$?

  if [ $curl_exit -ne 0 ]; then
    # curl error (timeout, connection refused, DNS failure, etc.)
    printf "  %-30s  %-10s  %s\n" "$label" "ERROR" "$url  ← curl exit $curl_exit (timeout or connection refused)"
    FAIL=$((FAIL + 1))
    RESULTS+=("FAIL $label")
    return
  fi

  # Accept 200-399 as healthy (200 OK, 301/302 redirects are fine for SPA routes)
  if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 400 ]; then
    printf "  %-30s  %-10s  %s\n" "$label" "HTTP $http_code ✓" "$url"
    PASS=$((PASS + 1))
    RESULTS+=("PASS $label")
  else
    printf "  %-30s  %-10s  %s\n" "$label" "HTTP $http_code ✗" "$url"
    FAIL=$((FAIL + 1))
    RESULTS+=("FAIL $label")
  fi
}

# ── Run checks ────────────────────────────────────────────────────────────────

echo ""
echo "══════════════════════════════════════════════════════════════════"
echo "  PRODUCTION SMOKE TEST"
echo "  Target : $BASE_URL"
echo "  Time   : $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "  Timeout: ${TIMEOUT}s per request"
echo "══════════════════════════════════════════════════════════════════"
echo ""
printf "  %-30s  %-10s  %s\n" "ROUTE" "STATUS" "URL"
echo "  $(printf '%.0s─' {1..70})"

check_route "Gateway liveness"    "/system/health"
check_route "API Server ping"     "/api/ping"
check_route "BizPortal"          "/bizportal/"
check_route "Logistic Order"     "/logistic-order/"
check_route "Customer Portal"    "/"

echo ""
echo "──────────────────────────────────────────────────────────────────"
echo "  PASSED : $PASS"
echo "  FAILED : $FAIL"
echo "──────────────────────────────────────────────────────────────────"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "❌  SMOKE TEST FAILED — $FAIL route(s) did not respond correctly."
  echo "    Do NOT declare this deployment successful."
  echo "    Check service logs and consider rolling back (Replit → Deploy → History)."
  echo ""
  exit 1
else
  echo "✅  SMOKE TEST PASSED — all $PASS routes are healthy."
  echo "    This deployment is confirmed live and serving requests."
  echo ""
  exit 0
fi
