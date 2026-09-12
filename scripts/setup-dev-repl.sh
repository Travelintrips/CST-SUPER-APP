#!/usr/bin/env bash
# =============================================================================
# setup-dev-repl.sh
# Jalankan sekali saat setup Repl baru, atau setelah git pull.
#
# Nilai secret tidak pernah disimpan atau dipulihkan dari Git. Replit Secrets
# dan Google Cloud Secret Manager adalah sumber nilai konfigurasi.
# =============================================================================
set -e

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║         CST Super App — Repl Dev Setup               ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# .replit is managed by Replit and must stay local. Removing it from the Git
# index keeps the local workflow/configuration file, while preventing future
# pulls from replacing it.
echo "▶ [1/3] Memastikan .replit tidak dilacak Git..."
if git ls-files --error-unmatch .replit > /dev/null 2>&1; then
  git rm --cached .replit
  echo "  ✓ .replit dikeluarkan dari Git; file lokal tetap dipertahankan."
else
  echo "  ✓ .replit sudah tidak dilacak Git."
fi

echo ""
echo "▶ [2/3] Install dependencies..."
PNPM_V9="/home/runner/workspace/.config/npm/node_global/bin/pnpm"
if [ -x "$PNPM_V9" ]; then
  export PATH="$(dirname "$PNPM_V9"):$PATH"
fi
pnpm install --no-frozen-lockfile
echo "  ✓ Dependencies terinstall."

echo ""
echo "▶ [3/3] Memeriksa nama konfigurasi..."
node scripts/verify-environment-config.mjs || true

echo ""
echo "══════════════════════════════════════════════════════"
echo "  Setup selesai! Jalankan workflow dari panel Replit."
echo "  Jangan commit .replit, .env, atau nilai secret apa pun."
echo "══════════════════════════════════════════════════════"
echo ""