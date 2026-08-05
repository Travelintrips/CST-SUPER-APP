---
name: Replit artifact workflow limits
description: Replit auto-adds artifact workflows (up to 10 total); workarounds for the 10-workflow limit when reconfiguring.
---

## Rule

Replit automatically adds one workflow per artifact (web, expo, etc.). These fill the 10-workflow cap and **cannot be removed** — `removeWorkflow()` on an artifact workflow returns `PROHIBITED_ACTION`.

**Why:** Artifact workflows are managed by Replit's platform, not by the agent.

## Limit behavior

- `configureWorkflow()` for an EXISTING workflow internally does create-then-delete, needing a temporary 11th slot — it fails with "Workflow limit exceeded (10/10)" even for updates.
- To reconfigure an existing workflow: first `removeWorkflow()` on a non-artifact workflow to free a slot, then call `configureWorkflow()`.

## Workaround pattern

```js
// 1. Check if slot is free
const wf = await listWorkflows();
if (wf.length >= 10) {
  // Remove a non-artifact root-level workflow
  await removeWorkflow({ name: "BizPortal" }); // example
}
// 2. Now reconfigure
await configureWorkflow({ name: "Watchdog Service", ... });
```

## Current layout (as of June 2026)

Root-level (configurable): API Server, Gateway, Watchdog Service  
Artifact-managed (cannot remove): api-server, bizportal, customer-portal, cst-driver, logistic-order, mockup-sandbox

Note: Replit may re-add removed root-level workflows within minutes. The system auto-restores them.
