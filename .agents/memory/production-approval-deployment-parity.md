---
name: Production approval deployment parity
description: Production financial approval must use the deployed code path that contains the reviewed guard fix.
---

Do not certify or bypass a production approval when the live deployment still rejects the request with a guard removed or changed in source. Publish the reviewed API build, then rerun the normal authenticated workflow.

**Why:** A live deployment can lag the workspace source; direct database or direct service calls would bypass authentication, audit, and the intended transactional safeguards.

**How to apply:** Compare the live approval log/error with the current source behavior, preserve the financial row unchanged when they differ, and queue deployment plus a fresh end-to-end proof before retrying.