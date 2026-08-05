---
name: Workspace package symlinks
description: Workspace packages in lib/ not symlinked to api-server node_modules after pnpm install changes.
---

## Rule
`@workspace/product-templates`, `@workspace/service-templates`, `@workspace/logistics-constants` live in `lib/` and declared as `workspace:*` deps in `artifacts/api-server/package.json`. If they don't appear in `artifacts/api-server/node_modules/@workspace/`, run `pnpm install --no-frozen-lockfile` from the project root.

**Why:** pnpm workspace symlinks are only created during `pnpm install`. If the lockfile is stale or install was interrupted, these symlinks can be missing — causing esbuild to report "Could not resolve @workspace/..." even though the source exists.

**How to apply:** Whenever api-server build fails with `Could not resolve "@workspace/..."`, run `pnpm install --no-frozen-lockfile` from project root. The existing lockfile will be respected for external packages; workspace symlinks will be re-created.
