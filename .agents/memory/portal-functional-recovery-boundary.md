---
name: Customer Portal functional recovery boundary
description: Production auth recovery requires live SMTP proof; marketplace publication must remain uncached at the public boundary.
---

Production database and Google callback routing can be healthy while OTP and password-reset authentication remain unavailable when the live SMTP transport check fails. A successful Google authorization redirect is not proof of callback, identity resolution, cookie issuance, or authenticated API access.

**Why:** The public API correctly excluded a production draft catalog item and Google start generated the custom-domain callback, but `/api/healthz` still reported `smtp: error`; source/build checks alone would have incorrectly certified the full recovery phase.

**How to apply:** Treat SMTP provider acceptance and a controlled end-to-end account as blocking evidence for OTP/reset/password recovery. Keep public catalog responses `no-store` so publication transitions cannot be masked by CDN or client cache.