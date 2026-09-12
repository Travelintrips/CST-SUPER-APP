---
name: API Server Missing External Packages After Restart
description: After environment restart, many external packages disappear from api-server/node_modules causing crash-loop
---

## The Problem
After environment restart, `artifacts/api-server/node_modules/` loses symlinks to packages that esbuild marks as **external** (not bundled). When Node.js loads the ESM bundle (`dist/index.mjs`), ALL static imports of external packages are resolved at module load time — if any are missing, the entire server fails to start.

**Why:** pnpm doesn't re-create node_modules symlinks after restart if they were transient.

## Two Fix Strategies

### Strategy A: Symlink from pnpm store (for packages IN the store)
```bash
STORE="/home/runner/workspace/node_modules/.pnpm"
API_NM="artifacts/api-server/node_modules"
# Check: ls $STORE | grep "^<pkg>@"
ln -sfn "$STORE/<pkg>@<version>/node_modules/<pkg>" "$API_NM/<pkg>"
```
Packages confirmed in pnpm store (as of July 2026):
- archiver@5.3.2, exceljs@4.4.0, jose@6.2.3, pdfkit@0.18.0, sharp@0.34.5, ws@8.20.1

### Strategy B: Convert to dynamic import (for packages NOT in store)
Replace static `import X from 'pkg'` with a lazy-loading pattern:
```ts
let _cache: any = null;
async function getPkg(): Promise<any> {
  if (_cache) return _cache;
  const mod = await import("pkg");
  _cache = mod.default ?? mod;
  return _cache;
}
```
- Move any module-level init code (like `webpush.setVapidDetails(...)`) inside the lazy loader
- Packages fixed this way: `googleapis` (googleSheets.ts), `web-push` (webPush.ts)

## Workflow After Fix
1. Run both fixes (symlinks + dynamic import rewrites)
2. Rebuild: `cd artifacts/api-server && node build.mjs`
3. Restart: `artifacts/api-server: API Server` workflow

## Warning Signs
Error pattern: `Cannot find package 'X' imported from .../dist/index.mjs` — each crash reveals the next missing package. Fix all at once using the external list in `build.mjs`.

**Why:** esbuild's `external` list in `build.mjs` — packages listed there become static ESM imports in the bundle. Missing = crash on load.
