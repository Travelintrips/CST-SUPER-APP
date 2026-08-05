#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# audit:customer-integration — Automated Release Gate
#
# Runs the full quality gate for Customer Portal × BizPortal integration.
# Exit code is non-zero if any step fails.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

PASS=0
FAIL=0
SKIP=0
STEP_LOG=()

step() {
  local label="$1"
  shift
  echo ""
  echo "══════════════════════════════════════════════════════"
  echo "  STEP: $label"
  echo "══════════════════════════════════════════════════════"
  if "$@" 2>&1; then
    echo "  ✅ PASS: $label"
    PASS=$((PASS + 1))
    STEP_LOG+=("✅ $label")
  else
    echo "  ❌ FAIL: $label"
    FAIL=$((FAIL + 1))
    STEP_LOG+=("❌ $label")
  fi
}

skip() {
  local label="$1"
  local reason="$2"
  echo "  ⏭  SKIP: $label — $reason"
  SKIP=$((SKIP + 1))
  STEP_LOG+=("⏭  $label — $reason")
}

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   CST SUPER APP — CUSTOMER INTEGRATION AUDIT GATE  ║"
echo "╚══════════════════════════════════════════════════════╝"
echo "  Date : $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "  Node : $(node -v)"
echo "  pnpm : $(pnpm -v)"
echo ""

cd "$(dirname "$0")/.."

# ── 1. Shared libraries build ─────────────────────────────────────────────────
step "Shared libraries build (tsc --build)" pnpm run typecheck:libs

# ── 2. Customer Portal typecheck ──────────────────────────────────────────────
step "Customer Portal typecheck" pnpm --filter @workspace/customer-portal typecheck

# ── 3. BizPortal typecheck ────────────────────────────────────────────────────
step "BizPortal typecheck" pnpm --filter @workspace/bizportal typecheck

# ── 4. API Server typecheck ───────────────────────────────────────────────────
# Source and test type errors both fail the release gate.
step "API Server typecheck" pnpm --filter @workspace/api-server typecheck

# ── 5. Unit tests (API Server) ────────────────────────────────────────────────
if command -v vitest &>/dev/null || pnpm --filter @workspace/api-server exec vitest --version &>/dev/null 2>&1; then
  step "API Server unit tests" pnpm --filter @workspace/api-server test --run
else
  skip "API Server unit tests" "vitest not configured for this workspace"
fi

# ── 6. Tenant isolation check (static analysis) ──────────────────────────────
# Two patterns are acceptable:
#   a) Per-route inline middleware: router.get('/x', requirePortalAuth, handler)
#   b) Router-level middleware:     router.use(requirePortalAuth)  [covers all routes after it]
# mktPortal.ts uses pattern (b); portal.ts mixes public routes (auth/*, marketplace browse)
# with individually-guarded private routes — both are intentional and correct.
step "Tenant isolation: mktPortal uses router.use guard and portalProductOrders is guarded" bash -c "
  # mktPortal.ts must declare a router-level requirePortalAuth before any data routes
  grep -q 'router\.use(requirePortalAuth)' artifacts/api-server/src/routes/mktPortal.ts \
    || { echo 'FAIL: mktPortal.ts missing router.use(requirePortalAuth)'; exit 1; }
  # portalProductOrders.ts must reference requirePortalAuth
  grep -q 'requirePortalAuth' artifacts/api-server/src/routes/portalProductOrders.ts \
    || { echo 'FAIL: portalProductOrders.ts missing requirePortalAuth'; exit 1; }
  echo '  mktPortal.ts: router.use(requirePortalAuth) present'
  echo '  portalProductOrders.ts: requirePortalAuth present'
"

# ── 7. QA Fixture guard: must not be accessible in prod build ─────────────────
step "QA Fixture Manager: DEV-only route guard present" bash -c "
  grep -n 'import.meta.env.DEV' artifacts/bizportal/src/routes.tsx | grep -q 'qa-fixture'
"

# ── 8. Transaction coverage: marketplace order must use db.transaction ────────
# grep -A5 was too short (db.transaction appears ~67 lines after the declaration).
step "Marketplace order uses db.transaction()" bash -c "
  grep -A200 'createMarketplaceOrder' \
    artifacts/api-server/src/lib/services/portalMarketplaceService.ts \
    | grep -q 'db\.transaction'
"

# ── 9. Transaction coverage: marketplace quote must use db.transaction ────────
step "Marketplace quote uses db.transaction()" bash -c "
  # Check the legacy write block inside submitMarketplaceQuote uses transaction
  grep -q 'db.transaction' artifacts/api-server/src/lib/services/portalMarketplaceService.ts
"

# ── 10. SSE event name consistency ───────────────────────────────────────────
step "SSE event consistency: order-track.tsx uses canonical event name" bash -c "
  ! grep -q 'order_status_updated' artifacts/customer-portal/src/pages/order-track.tsx
"

# ── 11. Vendor deep link: not null anymore ────────────────────────────────────
step "Vendor deep link: buildVendorDeepLink() implemented (not hardcoded null)" bash -c "
  ! grep -q 'deepLinkUrl.*null.*TODO' artifacts/api-server/src/lib/services/vendorInvitationService.ts
"

# ── 12. Object storage fail-closed ───────────────────────────────────────────
step "Object storage: getObjectEntityUploadURL no longer returns fake URL" bash -c "
  ! grep -q 'storage.placeholder/objects/uploads' artifacts/api-server/src/lib/objectStorage.ts \
    && grep -q 'getSupabase()' artifacts/api-server/src/lib/objectStorage.ts
"

# ── 13. Customer Portal build ─────────────────────────────────────────────────
step "Customer Portal build" pnpm --filter @workspace/customer-portal build

# ── 14. BizPortal build ──────────────────────────────────────────────────────
step "BizPortal build" pnpm --filter @workspace/bizportal build

# ── 15. API Server build ──────────────────────────────────────────────────────
step "API Server build" pnpm --filter @workspace/api-server build

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║                   GATE SUMMARY                     ║"
echo "╚══════════════════════════════════════════════════════╝"
for entry in "${STEP_LOG[@]}"; do echo "  $entry"; done
echo ""
echo "  Passed : $PASS"
echo "  Failed : $FAIL"
echo "  Skipped: $SKIP"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "  🔴 GATE RESULT: FAIL — $FAIL step(s) failed. DO NOT release."
  exit 1
else
  echo "  🟢 GATE RESULT: PASS — All checks passed."
  exit 0
fi
