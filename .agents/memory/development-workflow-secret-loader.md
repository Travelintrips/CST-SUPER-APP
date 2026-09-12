---
name: Development workflow secret loader
description: Readiness behavior when the managed GCP bootstrap credential is malformed in the development workflow.
---

The development API workflow must fail closed before opening its listener when `GCP_SECRET_MANAGER_BOOTSTRAP_JSON` is not valid JSON. A stored secret being present is not evidence that the loader can use it.

**Why:** bypassing the managed loader or substituting DEV/PROD credentials would break environment isolation and can make readiness appear healthy against the wrong database.

**How to apply:** repair the managed bootstrap secret through the workspace secret flow, then restart the exact API workflow and verify its port/readiness. Do not copy credential values into shell commands or bypass `load-secrets.mjs`.