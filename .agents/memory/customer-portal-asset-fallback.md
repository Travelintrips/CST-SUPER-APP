---
name: Customer Portal asset fallback
description: Legacy category and default-service paths can return JSON 400 even when primary portal assets are healthy.
---

The Customer Portal asset manifest is derived from source references, so a legacy image path remains a release blocker until the source uses an existing verified Storage object or an explicit safe fallback.

**Why:** Development Storage contained the primary logo, hero, product, service, and vehicle objects but not several old category/default-service keys; the browser could hide the failure with an onError gradient while the release verifier correctly rejected the 400 responses.

**How to apply:** Run the verifier through `load-secrets.mjs` with the matching `APP_ENV`, replace missing decorative references with already-verified canonical objects rather than duplicating uploads or changing production rows, regenerate the manifest, and rerun focused build and preview checks.