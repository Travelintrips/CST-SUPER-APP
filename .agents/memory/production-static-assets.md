---
name: Production static asset promotion
description: Development and production Supabase Storage buckets are separate deployment dependencies for public images and logos.
---

Production static assets require two independent checks: the live runtime must have
production Supabase storage credentials, and the referenced files must exist in
the production `public-assets` bucket. A successful development asset check does
not promote files or configuration to production.

**Why:** The customer portal can build successfully while every image request
fails in production when the deployment uses stale environment configuration or
the production bucket has not received the assets.

**How to apply:** Before certifying a publish, run the storage asset verifier
against both development and production bundles, then republish after any
production secret/configuration change. Validate the public asset URLs from the
live domain after publish.

Also verify the browser-requested path and response MIME, not only whether the
canonical production objects exist. A stale frontend bundle can request a
legacy raster path that returns `200 text/html` from the SPA fallback while the
correct WebP objects return `200 image/webp`.

**Why:** Object promotion and frontend bundle publication are independent; a
successful storage check cannot prove that the live UI is using the corrected
asset mapping.

**How to apply:** Inspect the live route's loaded bundle and test every
rendered asset URL after publishing the frontend bundle. Treat any legacy
`.png`/`.jpg` request or `text/html` image response as a republish blocker.