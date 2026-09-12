#!/usr/bin/env bash
set -euo pipefail

# Official loader wrapper. It deliberately runs each environment in a separate
# child process so DEV and PROD credentials can never be mixed in one process.
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

APP_ENV=development NODE_ENV=development SPORT_CENTER_FINANCE_MODE=legacy \
  node "$root/artifacts/api-server/load-secrets.mjs" \
  node "$root/scripts/cf-sc-13b-targeted-prod-parity.mjs" \
  --output "$tmp_dir/dev.json" >/dev/null

APP_ENV=production NODE_ENV=production SPORT_CENTER_FINANCE_MODE=legacy \
  node "$root/artifacts/api-server/load-secrets.mjs" \
  node "$root/scripts/cf-sc-13b-targeted-prod-parity.mjs" --prod \
  --output "$tmp_dir/prod.json" >/dev/null

node "$root/scripts/cf-sc-13b-compare.mjs" "$tmp_dir/dev.json" "$tmp_dir/prod.json"