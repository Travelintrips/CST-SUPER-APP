---
name: API loader dependency link
description: Environment-specific dependency state needed for direct API runtime proofs
---

Directly invoking the API secret loader can fail when the artifact's `node_modules` links are stale or incomplete, even while the already-running workflow is healthy.

**Why:** The workflow may have started from a previously materialized dependency tree, while a fresh shell proof resolves the artifact package boundary and fails before it can load the managed environment.

**How to apply:** Restore the artifact dependency links with the repository's frozen lockfile before running a direct loader-wrapped proof. Do not bypass the managed loader or substitute database credentials.