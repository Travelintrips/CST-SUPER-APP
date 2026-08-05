---
name: ESM external lazy import pattern
description: How to safely lazy-load esbuild external packages that may not be installed, avoiding ERR_MODULE_NOT_FOUND at startup
---

## The rule

When a package is listed in esbuild `external: [...]` but may not be installed at runtime, a static `import foo from "pkg"` causes `ERR_MODULE_NOT_FOUND` at Node.js _link phase (before any code runs). Dynamic `await import("pkg")` inside a function is NOT enough — esbuild may still emit a top-level static import in the bundle for externals.

**Use `createRequire` instead:**

```typescript
import { createRequire } from "node:module";
const _lazyReq = createRequire(import.meta.url);
let _mod: any = null;
function getMod(): any {
  if (!_mod) _mod = _lazyReq("pkg"); // throws only when called, not at startup
  return _mod;
}
```

Then call `getMod().method(...)` at each usage site instead of using the top-level import.

**Why:** `createRequire` produces a CJS-style `require()` call that Node.js resolves at CALL TIME, not at module graph link time. This means the package absence only errors when the function is actually invoked, not at server startup.

**How to apply:** Any esbuild external that might not be installed in production (e.g. `fluent-ffmpeg`, native binaries, optional system deps) — replace static import with this pattern. The api-server's `videoOptimizer.ts` uses this for `fluent-ffmpeg`.
