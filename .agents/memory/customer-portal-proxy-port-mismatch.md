---
name: Customer Portal vite proxy hardcoded to wrong port
description: /api proxy in customer-portal vite.config.ts pointed at :8080 while the real API forwarder listens on API_PORT (18444 by default) — caused total marketplace outage until fixed to match bizportal's pattern.
---

`artifacts/customer-portal/vite.config.ts` proxy targets for `/api`, `/sitemap.xml`, `/q` were hardcoded to `http://localhost:8080`. The api-server's actual dev architecture (see `artifacts/api-server/start-dev.sh`) opens a TCP forwarder on `FORWARDER_PORT` (default 18444) that relays to `INTERNAL_PORT` (default 18445) where Express really listens — nothing ever binds 8080 in that setup.

**Why:** This was pre-existing drift, not caused by any single feature change — bizportal's vite.config.ts already used the correct pattern (`` `http://localhost:${process.env.API_PORT ?? process.env.FORWARDER_PORT ?? 18444}` ``) while customer-portal's did not. When it's wrong, every `/api/*` call in customer-portal 500s/ECONNREFUSEDs — the whole marketplace and site content breaks silently until someone screenshots the live app instead of just curling the API directly.

**How to apply:** If a dev-mode screenshot of customer-portal shows blanket 500s on `/api/*` while `curl localhost:18444/api/...` works fine, check `vite.config.ts` proxy targets first — compare against bizportal's proxy config for the correct env-var-driven pattern.
