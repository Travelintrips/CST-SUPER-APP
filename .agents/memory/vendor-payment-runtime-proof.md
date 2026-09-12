---
name: Vendor payment runtime proof
description: Runtime proofs for authenticated vendor-invoice settlement must target the explicit development database and allow the idempotency replay write to complete.
---

Use `APP_ENV=development`, safe test mode, and `SUPABASE_DATABASE_URL_DEV` explicitly for vendor-payment proofs. The development Secret Manager loader may also populate shared `SUPABASE_DATABASE_URL` with the same development target, so URL inequality is not a valid production-safety assertion.

**Why:** The managed development loader deliberately aliases shared database keys, and idempotency response persistence is fire-and-forget after `res.json`; an immediate retry can briefly receive the in-flight `409` even though no duplicate journal is created.

**How to apply:** Reject deployment runtimes, never fall back to the built-in database, and wait briefly or poll before asserting a successful retry is served from the cached response.