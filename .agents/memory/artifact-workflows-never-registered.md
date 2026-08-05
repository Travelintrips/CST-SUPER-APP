---
name: Artifact workflows never auto-registered on this project type
description: What to do when api-server/bizportal/customer-portal/logistic-order artifact.toml files exist but pnpm install never triggers their auto-registration as workflows.
---

On this repo, waiting for artifact auto-registration after `pnpm install` (per
artifact-detection-delay.md) did NOT work even after ~10+ minutes — this
project's artifacts skill is scoped to `mockup-sandbox` only, so the platform
never materialized separate `api-server`/`bizportal`/`customer-portal`/
`logistic-order` service-type workflows from their `.replit-artifact/artifact.toml`
files, unlike on other imports of the same codebase.

**Fix:** the repo already ships `start-replit.sh` — a unified single-workflow
fallback that starts every upstream service as a background child process
(each yielding gracefully if a real artifact workflow's port is already
bound) and execs `gateway.mjs` in the foreground. Point the `Gateway`
workflow's command at it via `configureWorkflow({ name: "Gateway", command:
"bash start-replit.sh", waitForPort: 5000, outputType: "webview" })` instead
of `start-dev-all.sh` (which assumes the artifact workflows exist).
`start-replit.sh` did not start BizPortal itself originally (comment said
"managed by artifact workflow") — added a `start_if_free "BizPortal" ...`
call invoking `artifacts/bizportal/start-dev.sh` with `BIZPORTAL_PORT` set,
which already has its own 40s-wait-then-fallback logic for exactly this case.

**How to apply:** if `listWorkflows()` still shows only `Gateway` several
minutes after root `pnpm install` on this repo, stop waiting and switch to
`start-replit.sh` instead of continuing to poll.
