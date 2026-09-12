---
name: Deployment secrets vs workspace secrets
description: The project's Deployment secrets page is a separate store from workspace dev/prod secrets; agent tools can't see it. Don't declare a secret "missing" without checking where.
---

## Rule

Replit projects have (at least) two distinct secret stores:
1. **Workspace secrets** (dev/shared/production scopes as seen by `viewEnvVars`/`requestSecrets`) — what this agent's tools can inspect.
2. **Deployment secrets** — a separate page scoped to the published deployment, injected only into the production build. Not visible to `viewEnvVars` from the dev workspace at all.

**Why:** During an RC3 production-readiness audit, `viewEnvVars({ type: "secret" })` reported `SUPABASE_DATABASE_URL` as absent (only `SESSION_SECRET` existed in workspace scope). This was reported as a real blocker. The user then shared a screenshot of the project's Deployment secrets page showing `SUPABASE_DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, etc. already fully configured there — the "missing" secret was never actually missing in production, it was just invisible from this tool's vantage point.

**How to apply:**
- Before reporting a secret as a blocker in a readiness/audit report, check `viewEnvVars` for BOTH `development` and `production` environment args — but recognize that neither covers the Deployment secrets page.
- If a secret is reported as missing but the feature/service seems to work in production, or the user pushes back, ask explicitly whether they've checked the Deployment secrets page (Publishing → deployment settings) before concluding it's truly absent.
- When a user shares a secrets-panel screenshot, don't assume it is the workspace store — ask (or infer from UI chrome) whether it's Deployment secrets, a different host entirely, or this workspace, since the remediation path differs completely.
