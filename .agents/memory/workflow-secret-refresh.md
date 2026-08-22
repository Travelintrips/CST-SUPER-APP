---
name: Managed workflow secret refresh
description: Artifact workflows may need an explicit restart before newly available workspace secrets are visible to their child process.
---

Managed artifact workflows can retain a process environment from before a
workspace secret became available, even when one-off shell commands can load
the same secret successfully.

**Why:** The API workflow initially failed closed at the official Secret
Manager loader while the identical loader succeeded in a one-off command; an
explicit workflow restart refreshed the environment and restored readiness.

**How to apply:** After secret availability or loader configuration changes,
restart the exact managed workflow before diagnosing the application or
database as broken; then verify the workflow logs and `/api/health/ready`.