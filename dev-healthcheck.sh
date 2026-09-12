#!/usr/bin/env bash
# =============================================================================
# dev-healthcheck.sh
# Detects and kills stale port conflicts for all BizPortal dev services,
# then reports port status. Run this before starting dev workflows.
# =============================================================================

set -uo pipefail

# Associative map: port → service name
declare -A PORT_NAMES=(
  [8080]="API Server"
  [3000]="BizPortal"
  [3001]="Customer Portal"
  [3002]="Sport Center"
  [5000]="Gateway"
)

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log_free()  { echo -e "  ${GREEN}[FREE]${NC}  Port $1 — $2"; }
log_kill()  { echo -e "  ${YELLOW}[KILL]${NC}  Port $1 — $2 (stale process found)"; }
log_error() { echo -e "  ${RED}[WARN]${NC}  Port $1 — $2 could not be cleared"; }

echo ""
echo "==> BizPortal Dev Health Check"
echo "==> Scanning ports for stale conflicts..."
echo ""

KILLED=0
FAILED=0

for port in "${!PORT_NAMES[@]}"; do
  name="${PORT_NAMES[$port]}"

  if fuser "$port/tcp" > /dev/null 2>&1; then
    log_kill "$port" "$name"
    if fuser -k "$port/tcp" > /dev/null 2>&1; then
      # Wait up to 2s for the port to be released
      for i in 1 2 3 4; do
        sleep 0.5
        fuser "$port/tcp" > /dev/null 2>&1 || break
      done
      if fuser "$port/tcp" > /dev/null 2>&1; then
        log_error "$port" "$name"
        FAILED=$((FAILED + 1))
      else
        KILLED=$((KILLED + 1))
      fi
    else
      log_error "$port" "$name"
      FAILED=$((FAILED + 1))
    fi
  else
    log_free "$port" "$name"
  fi
done

echo ""
if [ "$KILLED" -gt 0 ]; then
  echo "==> Cleared $KILLED stale process(es)."
fi
if [ "$FAILED" -gt 0 ]; then
  echo "==> WARNING: $FAILED port(s) could not be cleared — check for locked processes."
fi
if [ "$KILLED" -eq 0 ] && [ "$FAILED" -eq 0 ]; then
  echo "==> All ports are clean — no conflicts detected."
fi
echo ""
