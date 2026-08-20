---
name: Portal auth cookie and reset origin
description: Customer Portal login and password-recovery boundaries for production.
---

Customer Portal password and email-OTP login responses must be consumed with credentials enabled and persisted through the HttpOnly portal session cookie. Password-reset links must be generated from the canonical production portal origin, not a browser-supplied origin.

**Why:** A backend-issued session can be lost when the frontend omits credentials or skips cookie persistence, while a stale/attacker-controlled reset origin makes a valid production email unusable or unsafe.

**How to apply:** Keep Google callback, OTP verification, password login, and reset requests same-origin with `credentials: include`; validate production reset hosts against the public portal domain and fail closed when mail delivery is unavailable.