---
name: RBAC guard on shared path prefix blocks "public" sub-routes
description: makeRbacGuard mounted on a path prefix (e.g. /logistic/orders) applies to every router mounted at that same prefix, including routes intended to be public/anonymous.
---

`router.use(prefix, makeRbacGuard(module), someRouter)` in `artifacts/api-server/src/routes/index.ts`
gates ALL routes inside `someRouter` — there is no per-route exemption. A route comment
saying "(public)" inside a guarded router is not actually reachable by anonymous users;
it will 401 before the handler ever runs.

**Why:** Found while hardening the logistic order tracking endpoint (`GET /track/:orderNumber`)
for the public customer portal — it had its own phone-verification second factor, but was
completely unreachable by anonymous visitors because it lived inside `logisticOrdersRouter`,
which is mounted behind `makeRbacGuard("rfq")` at `/logistic/orders`.

**How to apply:** When a route needs to be public but shares a path prefix with an
RBAC/admin-guarded router, extract it into its own small router and mount it at the same
prefix WITHOUT the guard, BEFORE the guarded router registration (Express matches path
mounts in registration order — first match wins). Never assume a route is reachable just
because its handler comment says "(public)"; verify with an unauthenticated curl request.
