---
name: Upstream services need real artifact workflows, not manual ones
description: Why bank-disbursement CoA dropdown / OCR / any BizPortal-Gateway feature can appear silently broken after a fresh import of this repo.
---

This repo (CST Logistics / BizPortal ERP) has `artifact.toml` files under each
`artifacts/*` directory (api-server, bizportal, customer-portal, logistic-order,
cst-driver, mockup-sandbox). After a fresh GitHub import, only the `Gateway`
workflow exists — the artifact workflows are NOT auto-registered until
`pnpm install` runs at the repo root (that's what triggers Replit's artifact
auto-detection from the `artifact.toml` files).

**Symptom:** Any frontend dropdown/action that depends on the API Server
(port 18444) fails silently — e.g. an empty CoA dropdown, "OCR gagal" — because
the frontend fetch wrapper swallows non-OK responses and returns `[]`/error
without surfacing "upstream service not running." Gateway itself boots fine
and looks "running," masking the real cause.

**Why:** Manually calling `configureWorkflow` for API Server before running
`pnpm install` creates a duplicate/competing workflow and still fails with
`Cannot find package 'esbuild'/'pg'` etc. (packages listed in package.json
but symlinks not materialized yet — see api-server-deps.md).

**How to apply:** On a fresh import of this repo, always run `pnpm install`
at the root FIRST. It will auto-register the artifact workflows for
api-server/bizportal/customer-portal/logistic-order/cst-driver/mockup-sandbox.
Start those, then restart Gateway last so it can reach all upstreams
(Gateway routes: /api→18444, /bizportal→6800, /logistic-order→19368,
/*→23434 customer-portal).
