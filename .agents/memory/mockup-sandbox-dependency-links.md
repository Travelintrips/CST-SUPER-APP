---
name: Mockup Sandbox dependency links
description: Recovery boundary when the managed Mockup Sandbox workflow cannot find Vite despite a valid manifest and lockfile.
---

If the Mockup Sandbox workflow fails with `vite: command not found` while Vite remains declared in its package manifest and resolved in the workspace lockfile, treat it as a missing workspace dependency link rather than a workflow or port configuration problem.

**Why:** Workspace dependency pruning or artifact changes can leave the sandbox package directory present but remove its Vite binary link; restarting the unchanged workflow cannot recover it.

**How to apply:** Restore dependencies from the existing lockfile for only the Mockup Sandbox package, then restart the managed artifact workflow and verify both the Vite-ready log and the `/__mockup` page. Do not create a duplicate workflow or hardcode a sibling artifact's Vite binary.