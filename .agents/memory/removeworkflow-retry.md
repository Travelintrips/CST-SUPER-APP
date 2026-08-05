---
name: removeWorkflow needs retry to fully delete
description: removeWorkflow() can report success but leave a stale config entry (state finished/failed) after the first call; must call it again to actually delete.
---

Observed when cleaning up duplicate legacy Replit workflows (API Server, BizPortal, Customer Portal, Logistic Order duplicating artifact-scoped workflows). First `removeWorkflow({name})` call stopped the process (state → finished/failed) but `listWorkflows()` still listed the entry. A second `removeWorkflow({name})` call actually removed it from the list.

**Why:** unclear if this is a caching/propagation delay or a two-phase stop-then-delete behavior, but relying on the first call's "success" response was misleading.

**How to apply:** after removing workflows, always re-run `listWorkflows()` to confirm the entry is actually gone, and call `removeWorkflow` again if it's still present.
