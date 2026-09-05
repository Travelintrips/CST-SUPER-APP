---
name: Browser smoke runtime
description: Boundary for interactive browser proofs in this Replit runtime.
---

Interactive CDP smoke may be unavailable because the shell Chromium binaries can fail on the workspace glibc ABI, while the managed preview browser remains usable for screenshots.

**Why:** Repeated local CDP launches failed before a browser target became available, but managed preview screenshots and HTTP route proofs continued to work.

**How to apply:** Treat screenshots as visual smoke and use authenticated harnesses or HTTP proofs for behavior unless an interactive browser runtime is explicitly available; do not alter project code or dependencies to work around the host browser ABI.