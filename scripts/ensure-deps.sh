#!/bin/bash
# ensure-deps.sh — Run pnpm install for any workspace package whose
# node_modules are missing or whose critical binaries are broken.
#
# Called automatically by start-dev-all.sh on cold start (fresh import /
# Replit restart). Safe to call multiple times — skips if deps are healthy.

set -euo pipefail
WORKSPACE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$WORKSPACE_ROOT"

log() { echo "[ensure-deps] $*"; }

need_install() {
  local pkg_dir="$1"
  local check_bin="$2"   # relative to pkg_dir/node_modules/.bin/
  [[ ! -d "$pkg_dir/node_modules" ]] && return 0
  [[ ! -e "$pkg_dir/node_modules/.bin/$check_bin" ]] && return 0
  return 1
}

INSTALL_NEEDED=0

# Root workspace
if [[ ! -d "$WORKSPACE_ROOT/node_modules/.pnpm" ]]; then
  log "Root node_modules/.pnpm missing — full install needed"
  INSTALL_NEEDED=1
fi

# Per-service sentinel checks
declare -A CHECKS=(
  ["artifacts/api-server"]="esbuild"
  ["artifacts/bizportal"]="vite"
  ["artifacts/customer-portal"]="vite"
  ["artifacts/logistic-order"]="vite"
  ["lib/db"]="drizzle-kit"
)

for pkg in "${!CHECKS[@]}"; do
  bin="${CHECKS[$pkg]}"
  dir="$WORKSPACE_ROOT/$pkg"
  if need_install "$dir" "$bin"; then
    log "Missing $bin in $pkg/node_modules — install needed"
    INSTALL_NEEDED=1
  fi
done

if [[ "$INSTALL_NEEDED" -eq 0 ]]; then
  log "All workspace deps present — skipping install"
  exit 0
fi

log "Running pnpm install at workspace root..."
pnpm install --prefer-offline 2>&1 | tail -5 || pnpm install 2>&1 | tail -5
log "pnpm install complete"
