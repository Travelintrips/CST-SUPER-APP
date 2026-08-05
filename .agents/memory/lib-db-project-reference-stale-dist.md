---
name: lib/db TS project reference stale dist
description: New Drizzle schema columns silently missing from tsc type-checks in artifacts using project references to lib/db
---

`lib/db/tsconfig.json` is `composite: true` with `emitDeclarationOnly` into `lib/db/dist`. Packages that reference it (e.g. `artifacts/api-server/tsconfig.json` has `"references": [{"path": "../../lib/db"}]`) resolve `@workspace/db` types through the **built `dist/*.d.ts` output**, not directly through the `exports` field's `./src/index.ts`, despite `moduleResolution: "bundler"`.

**Why:** TS project references intentionally prefer a referenced project's emitted declarations for incremental builds. If `lib/db/dist` is stale (generated before a schema column was added), dependent packages type-check against the old shape with zero warning — the error message just looks like "property does not exist," which is easy to misdiagnose as a typo or wrong import.

**How to apply:** After adding/changing columns in `lib/db/src/schema/*.ts`, if a dependent package's typecheck reports a schema field as missing that you just added, rebuild the referenced project's declarations before assuming the code is wrong:
```
cd lib/db && node ../../node_modules/typescript/bin/tsc -b .
```
Do NOT just `rm -rf lib/db/dist` — that breaks the reference entirely (`TS6305: Output file has not been built from source`). Always rebuild after deleting.
