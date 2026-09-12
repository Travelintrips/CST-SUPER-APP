---
name: Password reset safe-mode capture
description: Safe development mode suppresses SMTP delivery, so password-reset artifacts are not available to runtime harnesses by default.
---

Safe development mode disables external email delivery before the custom forgot-password flow calls the mailer. The flow still stores a bcrypt-hashed, expiring reset artifact, but a harness cannot recover the raw token from the notification log unless a test-only capture path is provided.

**Why:** A runtime vendor-lifecycle proof initially failed at reset-artifact capture even though the request and database write succeeded; safe mode intentionally skipped `sendMail`, so no simulated email log existed.

**How to apply:** Keep production credential behavior unchanged. For development proof, use a strictly harness-scoped capture mechanism or a canonical test adapter; never return reset tokens in normal API responses or logs.