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