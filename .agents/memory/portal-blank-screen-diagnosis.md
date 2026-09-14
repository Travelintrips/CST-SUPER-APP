---
name: Portal blank-screen diagnosis
description: How to distinguish a BizPortal bundle parse failure from an API or database outage when the production screen is blank.
---

When BizPortal renders a completely blank page, check the Vite/esbuild transform and dependency-scan errors before investigating page-specific API calls. A malformed JSX tag in an unrelated eagerly scanned module can prevent the entire application bundle from loading.

**Why:** The accounting route itself can be valid while a separate component parse error stops Vite from producing a usable client bundle; the visible symptom is only a dark/blank screen.

**How to apply:** Confirm `/api/health/live` and `/api/health/ready`, then inspect the portal workflow/deployment build logs for JSX, transform, or dependency-scan failures. Only debug accounting data/API responses after the production bundle builds cleanly.