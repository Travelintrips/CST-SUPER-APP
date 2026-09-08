---
name: Customer Portal readiness gates
description: Production readiness criteria for portal auth, customer/vendor routes, and order/payment transactions.
---

Customer Portal readiness requires server-side role/tenant ownership, canonical price calculation, actor-bound idempotency, atomic payment/status transitions, and an auditable link between uploaded payment evidence and its order or invoice.

**Why:** Public portal flows can pass happy-path auth and ownership tests while product-order APIs still accept forged totals, expose invoices by display name, or let broad internal sessions mutate arbitrary orders.

**How to apply:** Treat any unproven high-impact transaction boundary as NOT_READY; require adversarial two-account, role-matrix, replay/concurrency, and failure-injection proofs before production approval.

Production portal cookies using `SameSite=None` need an explicit CSRF defense (token or strict origin protection) on every state-changing route; CORS alone is not a CSRF control.

**Why:** Credentialed cross-site form requests can mutate state even when response-reading CORS is restricted.

**How to apply:** Pair the cookie policy with a tested CSRF/origin middleware and verify JSON, multipart, and URL-encoded mutation paths.