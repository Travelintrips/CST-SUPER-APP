---
name: Production database availability gate
description: A production read-only audit cannot proceed when the workspace has no provisioned production database.
---

Treat the database service's explicit “no production database” result as a hard safety boundary. Do not substitute DEV, infer PROD state from historical evidence, or classify/add COA accounts.

**Why:** Production queries are only safe when the target is explicitly identifiable; a missing production replica makes even read-only verification unverifiable.

**How to apply:** Record the audit as blocked, preserve historical evidence as unverified, and resume only after the platform exposes an identifiable production database.