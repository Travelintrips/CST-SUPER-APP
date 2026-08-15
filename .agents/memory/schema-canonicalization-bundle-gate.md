---
name: Schema canonicalization bundle gate
description: Strict DEV/PROD schema reconciliation requires APP_ENV metadata in each environment-specific GCP secret bundle.
---

The canonical schema reconciliation wrapper must fail closed when the production
Secret Manager bundle does not include `APP_ENV=production`. The official loader
can still validate and load the bundle, but that is not enough to prove that a
schema worker is using the intended environment.

**Why:** A production bundle without environment metadata can load valid
credentials while the schema sync cannot prove the bundle identity. Bypassing
the gate risks cross-environment schema reads or writes.

**How to apply:** Add the metadata through the approved GCP Secret Manager
change process, then rerun the strict read-only canonical report before any
production remediation. Never work around the gate by changing the wrapper to
ignore the missing metadata.