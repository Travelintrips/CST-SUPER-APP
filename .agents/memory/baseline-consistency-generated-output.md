---
name: Baseline consistency and generated output
description: Cold-checkout verification can differ from post-build verification when ignored generated modules are required by a workspace package.
---

Cold-checkout typecheck and post-build typecheck are distinct evidence states
when a package imports generated files that are intentionally ignored by Git.

**Why:** The mockup sandbox generates its module map during the build, so a
clean checkout can fail typecheck before build and pass after build without any
source change. Historical baseline reports may also cover only one package or
an earlier data state.

**How to apply:** Record the exact command order and workspace scope. Do not
label the repository healthy from a package-only or historical PASS; report
cold-checkout and post-build results separately, and treat live development DB
regressions as environment evidence.

Runtime regression scripts are not interchangeable with the workspace Vitest
suite: legacy scripts may assume a different API port or database schema than
the configured artifact workflow.

**Why:** The configured API workflow listens on its artifact port, while older
regression scripts can default to another port and may seed legacy tables before
testing. A clean unit suite therefore does not prove those scripts are runnable.

**How to apply:** Run legacy HTTP regressions against the workflow's actual
port and report port/schema incompatibilities as explicit regression blockers,
without changing source code during baseline validation.

For API package typecheck, build the referenced workspace declarations first
(`pnpm run typecheck:libs`), then run the package typecheck; otherwise TypeScript
can report missing `TS6305` outputs even when the source is clean.

**Why:** The API project references generated declaration outputs from shared
workspace packages, and those outputs may be absent or stale after a fresh
checkout or an isolated package check.

**How to apply:** Treat the declaration build as part of the validation
preflight, and report its command order when documenting typecheck evidence.

The same declaration preflight applies to BizPortal package typecheck because it
imports generated workspace client and storage declarations.

**Why:** A direct BizPortal typecheck from the current checkout produced a large
baseline cascade until the shared declarations were forced-built first.

**How to apply:** Run `pnpm run typecheck:libs` before either API or BizPortal
package typecheck when validating this monorepo.

Because declaration directories are ignored, a stale `tsconfig.tsbuildinfo`
can make `tsc --build` report success while the referenced output files are
missing. A missing-output check must use a forced rebuild rather than relying
on incremental state alone.

**Why:** Removing generated `dist` files does not necessarily invalidate
TypeScript's incremental project state, which can recreate the misleading
`TS6305` cascade in an isolated package check.

**How to apply:** Keep root declaration preflight forced, and make direct API
typecheck invoke the same forced preflight before checking `src`.

Unit tests for admin guards also need the runtime admin configuration loaded
when they assert invalid-token behavior. Without it, the intentional
fail-closed response is 503 rather than the configured 401/403.

**Why:** The live development API returned 401 for the same invalid token
while isolated Vitest processes lacked the admin configuration.

**How to apply:** Distinguish missing-config unit setup from live authorization
evidence; do not weaken the fail-closed guard merely to satisfy the isolated
test.