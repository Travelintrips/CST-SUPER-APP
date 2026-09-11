---
name: Quality gate shared project references
description: Build ordering and memory requirements for workspace typechecks
---

## Rule
Run the root composite declaration build before artifact typechecks: `pnpm run typecheck:libs`. Do not run the shared-library build concurrently with portal or API typechecks.

**Why:** TypeScript project references can report TS6305 when a dependent declaration is still missing or being rebuilt. The API typecheck can also exhaust the default Node heap when run beside several large frontend checks.

**How to apply:** Build shared declarations first, then run portal/BizPortal/API checks sequentially or with bounded concurrency. Use a larger `NODE_OPTIONS` heap for the API typecheck/build when the workspace is under load.