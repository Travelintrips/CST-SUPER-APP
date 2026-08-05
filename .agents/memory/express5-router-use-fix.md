---
name: Express 5 Router Use Middleware Fix
description: Express 5 bug where a Router without any router.use() middleware causes many routes to return 404 despite being registered.
---

## The Rule

Every Express 5 Router that mounts multiple routes must have at least one `router.use()` call registered **before** the first route handler.

**Fix:**
```typescript
const router = Router();
router.use((_req, _res, next) => next()); // ← required no-op; prevents 404 bug
router.get("/my-route", handler);
```

**Why:** In Express 5 (using path-to-regexp v8), a Router without any `use()` layers fails to match a large portion of its route handlers, returning 404 even for registered routes. The effect is non-deterministic — some routes near the top of the stack (e.g., the first 2-3) still work, but most don't. Adding a no-op `router.use()` as the very first registration fixes all routes.

**How to apply:** Any new Router file in this project should include the no-op `router.use()` immediately after `const router = Router()`. Also check existing Router files if they exhibit unexplained 404s on registered routes.

**Observed symptom:** First few requests to failing routes took ~1 second (lazy init timeout); subsequent requests were instant (0-2ms) — all 404. Working routes returned 401 in 0-1ms. The dist compiled correctly with all routes present on the same router instance.
