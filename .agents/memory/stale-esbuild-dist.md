---
name: Stale esbuild dist causes phantom 404s / hangs
description: api-server runs a prebuilt dist; a stale dist serves missing routes as HTML 404 and runs old hanging route code
---

# Stale esbuild dist in api-server

`artifacts/api-server` does NOT run TypeScript directly in dev — `start-dev.sh` runs
`build.mjs` (esbuild, clean rebuild via `rm distDir`) then runs `node dist/index.mjs`
behind a port-forwarder (8080 ← 18444).

**Symptom:** a route present in `src/routes/*.ts` returns `404 "Cannot GET ..."` (HTML),
or runs old/hanging logic, even though the source is correct. Through the frontend this
surfaces as `Failed to execute 'json' on 'Response': Unexpected token '<', "<!DOCTYPE"...`
because the client does `.json()` on an HTML 404/504 page.

**Why:** the running `dist/index.mjs` was built from older source. A global middleware on
e.g. `/api/accounting/*` returns `401` for unauthenticated requests *before* route
matching, so an unauthenticated curl looks fine (fast 401) — but an *authenticated*
request passes the middleware, Express finds no matching route, and returns 404 HTML.
That asymmetry (401 without auth, 404 with auth) is the tell that the route isn't in the
running bundle.

**How to apply / diagnose:**
- Reproduce WITH an admin session. Dev login: `POST /api/dev-login {"email":"<admin>@..."}`
  (disabled when `REPLIT_DEPLOYMENT=1`), capture the `sid` cookie, then hit the route.
- Confirm staleness: `rg -c "<route-string>" artifacts/api-server/dist/index.mjs`.
- Fix: `cd artifacts/api-server && rm -f dist/index.mjs && node build.mjs`, then restart
  the `artifacts/api-server: API Server` workflow. A normal workflow restart rebuilds.
- To test Google Sheets service-account code standalone, put the script INSIDE
  `artifacts/api-server/` (not /tmp) so pnpm resolves `googleapis`; delete after.
