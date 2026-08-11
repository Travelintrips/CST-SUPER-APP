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