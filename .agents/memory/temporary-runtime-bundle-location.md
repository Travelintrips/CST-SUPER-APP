---
name: Temporary runtime bundle location
description: Workspace dependency resolution for one-off TypeScript ESM proof runners.
---

One-off ESM bundles that leave workspace dependencies external must be written under the workspace tree, not `/tmp`, so Node can resolve the project's ancestor `node_modules`.

**Why:** Node ESM resolves external packages relative to the bundle location; a `/tmp` bundle could not resolve `pg` and `pino` even though the workspace installation was healthy.

**How to apply:** Write temporary proof entrypoints/bundles under the relevant artifact directory, run them through the official environment loader, and remove both source and generated bundle immediately afterward.