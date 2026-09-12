---
name: Artifact auto-registration delay after pnpm install
description: Why upstream artifact workflows (api-server, bizportal, customer-portal, logistic-order, etc.) appear missing right after a fresh import even though .replit-artifact/artifact.toml files exist.
---

On this repo (CST Logistics / BizPortal ERP + Sport Center), each `artifacts/*`
package ships its Replit artifact config at `artifacts/<name>/.replit-artifact/artifact.toml`
(not a plain `artifacts/<name>/artifact.toml`). After a fresh import, running
`pnpm install` does NOT synchronously register the artifact workflows —
detection lands asynchronously, sometimes several minutes later, as an
`automatic_updates` event ("Added artifact: ..." / "Configured workflows
changed"). Don't conclude artifacts aren't supported just because they're
absent from `listWorkflows()` immediately after install.

**Symptom to avoid mis-diagnosing:** if you jump to hand-rolling a
single-workflow fallback (spawning all upstream services as background
processes inside the Gateway workflow's shell script) before detection
completes, you'll fight transient, hard-to-explain crashes (e.g. `gateway.mjs`
getting silently `Killed` seconds after boot) that have nothing to do with
your code — then have to revert everything once the real artifact workflows
show up on their own.

**How to apply:** after root `pnpm install` on this repo, wait for the
`automatic_updates` artifact-registration event (or poll `listWorkflows()`
periodically) before deciding upstream services need a workaround. Once the
artifact workflows exist, start them in dependency order — api-server,
bizportal, customer-portal, logistic-order — then start Gateway last, per
`start-dev-all.sh`'s own comments.
