#!/bin/bash
set -e

echo "=== Post-merge setup ==="

# Validate environment names without printing any secret values. Replit/GCP
# environment state is intentionally outside Git and must survive pull/push.
echo "[0/4] Checking environment configuration..."
node scripts/verify-environment-config.mjs || echo "[post-merge] environment check warning — lihat daftar nama di atas."

# pnpm v9 is required — lockfileVersion 9.0 is not supported by the Nix-bundled v8.
# npm install -g pnpm@9 installs to the path below; use it if available.
PNPM_V9="/home/runner/workspace/.config/npm/node_global/bin/pnpm"
if [ -x "$PNPM_V9" ]; then
  export PATH="$(dirname "$PNPM_V9"):$PATH"
fi
echo "[pnpm] using: $(pnpm --version)"

# Install all workspace packages.
echo "[1/4] Installing dependencies..."
pnpm install --no-frozen-lockfile

# Ensure @uppy/* packages are symlinked into lib/object-storage-web/node_modules.
mkdir -p lib/object-storage-web/node_modules/@uppy
for pkg in core react dashboard aws-s3; do
  dir=$(ls -d node_modules/.pnpm/@uppy+${pkg}@*/node_modules/@uppy/${pkg} 2>/dev/null | head -1)
  if [ -n "$dir" ]; then
    ln -sfn "$(pwd)/$dir" "lib/object-storage-web/node_modules/@uppy/${pkg}"
  fi
done

# Apply DB migrations directly (bypasses drizzle-kit interactive rename prompts)
echo "[2/4] Applying DB migrations..."
node scripts/apply-migrations.mjs

# Report schema drift only. Production changes must be explicitly reviewed and
# applied through scripts/run-sync-schema-additive.mjs --apply, which loads
# development and production bundles separately through the official loader.
echo "[3/4] Reporting schema drift dev→prod (read-only)..."
node scripts/sync-schema-dev-to-prod.mjs || echo "[post-merge] schema report skipped/warning — lihat output di atas."

# Seed accounting journals on dev DB (non-fatal safety net).
# If COA not yet seeded (fresh DB reset), this exits cleanly and defers to
# API server startup which runs seedAccountingDefaults automatically.
echo "[4/4] Seeding accounting journals on dev DB (non-fatal)..."
node scripts/seed-accounting-journals.mjs || echo "[post-merge] journal seed skipped — akan di-seed saat API server startup."

echo "=== Post-merge selesai ==="
