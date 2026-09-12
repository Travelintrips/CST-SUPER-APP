---
name: Imported project first-boot fixes
description: Durable lessons for getting this multi-artifact repo (Gateway/API Server/BizPortal/Logistic Order/Customer Portal) running after a fresh import/clone.
---

- **Monorepo install invariant:** a fresh clone/import never has `node_modules` populated for the root or any `artifacts/*` package. Any workflow failing with "Cannot find package/module" for a dependency that IS listed in package.json (pg, esbuild, vite, tsc, etc.) means install hasn't run yet — not a missing dependency. Fix: root-level `pnpm install`, then restart all workflows.
- **Symptom pattern:** watchdog CB (circuit breaker) OPEN state during a service's cold boot is expected while it runs schema migrations and starts background workers — it self-clears to CLOSED once the service starts responding. Don't treat a transient CB OPEN as a real outage; check `/system/global-health` after giving the service time to finish booting.
