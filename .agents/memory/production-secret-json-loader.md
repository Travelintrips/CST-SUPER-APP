---
name: Production secret bundle JSON validation
description: CF-SC-12C recovery can be blocked before database access by malformed managed production secret JSON.
---

The official production Secret Manager loader must remain the only credential
path for PROD recovery. A malformed latest bundle can fail JSON parsing before
the runner opens a database connection, even if the same bundle loaded
successfully earlier.

**Why:** Bypassing the loader or manually extracting credentials would weaken
the production safety boundary and could make target verification unreliable.

**How to apply:** Treat repeated `Secret payload is not a valid JSON object`
errors as a managed secret-bundle repair blocker. Do not retry database work
through copied values; rerun the official loader after the bundle is repaired.