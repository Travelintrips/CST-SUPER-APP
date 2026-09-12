#!/usr/bin/env bash
# =============================================================================
# PPJK Tenant Isolation — UAT Smoke Test (Development Environment)
# =============================================================================
#
# Verifies cross-tenant isolation with two real authenticated sessions.
# Runs against the dev API server (default: http://localhost:18444).
#
# Prerequisites:
#   1. API server running on $API_BASE (default localhost:18444)
#   2. Two user accounts created in the dev DB:
#      - TENANT_A_EMAIL / TENANT_A_PASSWORD  (company_id = COMPANY_A)
#      - TENANT_B_EMAIL / TENANT_B_PASSWORD  (company_id = COMPANY_B, different from A)
#      - PLATFORM_EMAIL / PLATFORM_PASSWORD  (role = super_admin or platform_admin, no company)
#
# Usage:
#   TENANT_A_EMAIL=a@example.com TENANT_A_PASSWORD=pass1 \
#   TENANT_B_EMAIL=b@example.com TENANT_B_PASSWORD=pass2 \
#   PLATFORM_EMAIL=platform@example.com PLATFORM_PASSWORD=pass3 \
#   ORDER_A_ID=7 \
#   bash artifacts/api-server/scripts/ppjk-uat-smoke.sh
#
# Each test prints:  [PASS] or [FAIL]  + endpoint + actual status + expected
# Exit code: 0 = all pass, 1 = any failure.
#
# =============================================================================

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:18444}"
AUTH_PATH="${AUTH_PATH:-/api/auth/login}"
PPJK_BASE="$API_BASE/api/ppjk"

TENANT_A_EMAIL="${TENANT_A_EMAIL:-}"
TENANT_A_PASSWORD="${TENANT_A_PASSWORD:-}"
TENANT_B_EMAIL="${TENANT_B_EMAIL:-}"
TENANT_B_PASSWORD="${TENANT_B_PASSWORD:-}"
PLATFORM_EMAIL="${PLATFORM_EMAIL:-}"
PLATFORM_PASSWORD="${PLATFORM_PASSWORD:-}"
ORDER_A_ID="${ORDER_A_ID:-}"   # ID of a PPJK order belonging to Tenant A

PASS=0
FAIL=0

# ── Colour ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[1;33m'
NC='\033[0m'

# ── Guard ─────────────────────────────────────────────────────────────────────
if [[ -z "$TENANT_A_EMAIL" || -z "$TENANT_B_EMAIL" || -z "$PLATFORM_EMAIL" || -z "$ORDER_A_ID" ]]; then
  echo -e "${RED}ERROR: Required env vars not set. See usage in script header.${NC}"
  exit 1
fi

# ── Login helper (returns cookie jar path) ────────────────────────────────────
login() {
  local email="$1" password="$2" label="$3"
  local jar
  jar=$(mktemp /tmp/ppjk-uat-XXXXXX.jar)
  local resp
  resp=$(curl -s -w "\n%{http_code}" -c "$jar" -X POST "$API_BASE$AUTH_PATH" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}")
  local code
  code=$(echo "$resp" | tail -1)
  if [[ "$code" != "200" ]]; then
    echo -e "${RED}[FATAL] Login failed for $label ($email) — HTTP $code${NC}"
    exit 1
  fi
  echo "$jar"
}

# ── Assert helper ─────────────────────────────────────────────────────────────
# assert <label> <cookie_jar> <method> <url> [<body_json>] <expected_status...>
assert() {
  local label="$1" jar="$2" method="$3" url="$4"
  local body="" expected=()
  # Remaining args: optional body then expected codes
  shift 4
  if [[ "$1" == "{"* || "$1" == "null" ]]; then
    body="$1"; shift
  fi
  expected=("$@")

  local curl_args=(-s -w "\n%{http_code}" -b "$jar" -X "$method" "$url" -H "Content-Type: application/json")
  [[ -n "$body" ]] && curl_args+=(-d "$body")

  local resp
  resp=$(curl "${curl_args[@]}" 2>&1)
  local actual
  actual=$(echo "$resp" | tail -1)
  local body_preview
  body_preview=$(echo "$resp" | head -1 | cut -c1-120)

  local matched=false
  for exp in "${expected[@]}"; do
    [[ "$actual" == "$exp" ]] && matched=true && break
  done

  if $matched; then
    echo -e "  ${GRN}[PASS]${NC} $label → HTTP $actual (expected ${expected[*]})"
    ((PASS++)) || true
  else
    echo -e "  ${RED}[FAIL]${NC} $label → HTTP $actual (expected ${expected[*]}) | $body_preview"
    ((FAIL++)) || true
  fi
}

# ── Login ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${YLW}=== PPJK UAT Smoke Test — $(date) ===${NC}"
echo -e "API: $API_BASE"
echo -e "Order A ID: $ORDER_A_ID"
echo ""
echo "Logging in..."

JAR_A=$(login "$TENANT_A_EMAIL" "$TENANT_A_PASSWORD" "Tenant A")
JAR_B=$(login "$TENANT_B_EMAIL" "$TENANT_B_PASSWORD" "Tenant B")
JAR_P=$(login "$PLATFORM_EMAIL" "$PLATFORM_PASSWORD" "Platform Admin")

echo -e "  ${GRN}All sessions established.${NC}"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
echo "=== 1. Tenant A — access their own order (expect 200) ==="
# ─────────────────────────────────────────────────────────────────────────────
assert "Tenant A / GET orders list"        "$JAR_A" GET  "$PPJK_BASE/orders"                               200
assert "Tenant A / GET orders/:id detail"  "$JAR_A" GET  "$PPJK_BASE/orders/$ORDER_A_ID"                   200
assert "Tenant A / GET timeline"           "$JAR_A" GET  "$PPJK_BASE/orders/$ORDER_A_ID/timeline"          200
assert "Tenant A / GET checklist"          "$JAR_A" GET  "$PPJK_BASE/orders/$ORDER_A_ID/checklist"         200
assert "Tenant A / GET sla"                "$JAR_A" GET  "$PPJK_BASE/orders/$ORDER_A_ID/sla"               200
assert "Tenant A / GET dashboard"          "$JAR_A" GET  "$PPJK_BASE/dashboard"                            200
assert "Tenant A / GET overdue"            "$JAR_A" GET  "$PPJK_BASE/overdue"                              200
assert "Tenant A / GET order dashboard"    "$JAR_A" GET  "$PPJK_BASE/orders/$ORDER_A_ID/dashboard"         200
assert "Tenant A / GET audit-log"          "$JAR_A" GET  "$PPJK_BASE/orders/$ORDER_A_ID/audit-log"         200

echo ""

# ─────────────────────────────────────────────────────────────────────────────
echo "=== 2. Tenant B — cross-tenant attempt on Tenant A's order (expect 403/404) ==="
# ─────────────────────────────────────────────────────────────────────────────
assert "Tenant B / GET orders/:id detail"  "$JAR_B" GET  "$PPJK_BASE/orders/$ORDER_A_ID"                   403 404
assert "Tenant B / GET timeline"           "$JAR_B" GET  "$PPJK_BASE/orders/$ORDER_A_ID/timeline"          403 404
assert "Tenant B / GET checklist"          "$JAR_B" GET  "$PPJK_BASE/orders/$ORDER_A_ID/checklist"         403 404
assert "Tenant B / GET sla"                "$JAR_B" GET  "$PPJK_BASE/orders/$ORDER_A_ID/sla"               403 404
assert "Tenant B / GET order dashboard"    "$JAR_B" GET  "$PPJK_BASE/orders/$ORDER_A_ID/dashboard"         403 404
assert "Tenant B / GET audit-log"          "$JAR_B" GET  "$PPJK_BASE/orders/$ORDER_A_ID/audit-log"         403 404
assert "Tenant B / POST workflow"          "$JAR_B" POST "$PPJK_BASE/orders/$ORDER_A_ID/workflow"          '{"status":"waiting_documents"}' 403 404
assert "Tenant B / POST assign"            "$JAR_B" POST "$PPJK_BASE/orders/$ORDER_A_ID/assign"            '{"assignedOfficerName":"Attacker"}' 403 404
assert "Tenant B / POST checklist write"   "$JAR_B" POST "$PPJK_BASE/orders/$ORDER_A_ID/checklist"         '{"docType":"invoice","status":"uploaded"}' 403 404
assert "Tenant B / PATCH checklist item"   "$JAR_B" PATCH "$PPJK_BASE/orders/$ORDER_A_ID/checklist/1"      '{"status":"verified"}' 403 404
assert "Tenant B / POST ai-assist"         "$JAR_B" POST "$PPJK_BASE/orders/$ORDER_A_ID/ai-assist"         '{"query":"test"}' 403 404
assert "Tenant B / DELETE"                 "$JAR_B" DELETE "$PPJK_BASE/orders/$ORDER_A_ID"                 '{"reason":"attack delete"}' 403 404
assert "Tenant B / PUT update"             "$JAR_B" PUT  "$PPJK_BASE/orders/$ORDER_A_ID"                   '{"notes":"attack"}' 403 404

echo ""
echo "  (Tenant B list should only show Tenant B's own orders — verify manually)"
assert "Tenant B / GET orders list (own)"  "$JAR_B" GET  "$PPJK_BASE/orders"                               200

echo ""

# ─────────────────────────────────────────────────────────────────────────────
echo "=== 3. Platform Admin — cross-tenant access (expect 200) ==="
# ─────────────────────────────────────────────────────────────────────────────
assert "Platform / GET orders list global" "$JAR_P" GET  "$PPJK_BASE/orders"                               200
assert "Platform / GET orders/:id (Tenant A order)" "$JAR_P" GET "$PPJK_BASE/orders/$ORDER_A_ID"           200
assert "Platform / GET dashboard global"   "$JAR_P" GET  "$PPJK_BASE/dashboard"                            200
assert "Platform / GET overdue global"     "$JAR_P" GET  "$PPJK_BASE/overdue"                              200

echo ""

# ─────────────────────────────────────────────────────────────────────────────
echo "=== 4. DELETE guard — reason required ==="
# ─────────────────────────────────────────────────────────────────────────────
assert "Tenant A / DELETE without reason → 400" "$JAR_A" DELETE "$PPJK_BASE/orders/$ORDER_A_ID" '{}' 400
assert "Tenant A / DELETE with short reason → 400" "$JAR_A" DELETE "$PPJK_BASE/orders/$ORDER_A_ID" '{"reason":"ab"}' 400

echo ""

# ─────────────────────────────────────────────────────────────────────────────
echo "=== Summary ==="
# ─────────────────────────────────────────────────────────────────────────────
TOTAL=$((PASS + FAIL))
echo ""
if [[ $FAIL -eq 0 ]]; then
  echo -e "${GRN}All $TOTAL checks passed.${NC}"
  EXIT=0
else
  echo -e "${RED}$FAIL/$TOTAL checks FAILED.${NC}"
  EXIT=1
fi

# Clean up cookie jars
rm -f "$JAR_A" "$JAR_B" "$JAR_P"

exit $EXIT
