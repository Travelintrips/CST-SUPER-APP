---
name: Express wildcard route array param bug
description: Express 5 named wildcard params ({*name}) are arrays; stringifying before checking Array.isArray silently corrupts multi-segment paths.
---

In Express 5, a named wildcard segment like `router.get("/foo/{*path}", ...)` puts an
**array** of path segments in `req.params.path` (not a single string).

A common bug pattern: `const raw = String(req.params.path); const joined = Array.isArray(raw) ? raw.join("/") : raw;`
— `String()` on an array runs `Array.prototype.toString`, which comma-joins the
segments (`"a,b"`) *before* the `Array.isArray` check ever runs (it's now always false
since `raw` is already a string). The result silently mangles any multi-segment path,
turning `/a/b` into `/a,b`. This causes downstream lookups (e.g. object storage by
path) to silently 404 even though the underlying resource exists and credentials/config
are correct — easy to misdiagnose as an auth/env/cache problem instead.

**How to apply:** always check `Array.isArray(rawParam)` on the *original* param before
any `String()` coercion: `Array.isArray(rawParam) ? rawParam.join("/") : String(rawParam)`.
When debugging a wildcard-route 404 that "should" work, log the raw param's type/shape
first, don't assume it's a string.
