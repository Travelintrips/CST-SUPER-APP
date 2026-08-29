---
name: API artifact preview health
description: API artifact preview checks may reject a healthy API when the default root path is not a 200 response.
---

Artifact API workflows can be marked failed by the platform preview check when the server root returns 404, even though the API is listening and `/api/health/live` plus `/api/health/ready` return 200.

**Why:** The API artifact is namespaced under `/api`; its readiness contract is not necessarily the root URL expected by the generic artifact preview check.

**How to apply:** Diagnose the actual listener and namespaced health endpoints before changing application startup code or credentials. Treat direct liveness/readiness responses as the runtime evidence.