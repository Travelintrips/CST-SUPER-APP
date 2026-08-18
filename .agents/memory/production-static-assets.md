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
live domain after publish. In Replit preview, do not default asset URLs to the
custom website domain; use the configured Supabase public-assets CDN or a
same-origin proxy so preview is independent of stale domain ownership.

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

The current production branding objects `logo.png` and `logo-baru.png` are
valid PNGs, while their WebP counterparts may not exist. Brand-logo references
must therefore remain on the published PNG format until derived WebP objects
are explicitly promoted.

**Why:** A global PNG-to-WebP resolver changed visible branding requests to
missing objects even though the original production logo was healthy.

**How to apply:** When changing the raster resolver, test logo and logo-baru
separately from vehicle/content assets; verify both the header and PWA
manifest/service-worker icon URLs against production.

Development static-asset promotion can be blocked independently by Supabase
Storage connection limits (`429 too_many_connections`), even when the source
production object is healthy. A dev-only proxy fallback may keep the hero
previewable, but it does not replace a later bucket synchronization check.

**Why:** Preview readiness and storage promotion are separate concerns; retries
against a saturated Storage service do not prove an asset or application bug.

**How to apply:** Verify the canonical production object first, keep preview
fallbacks scoped to the affected static asset, and retry promotion only after
the Storage connection limit clears.

Development favicon uploads can also fail with gateway/database timeouts while
the production branding object remains healthy. A narrowly scoped dev proxy to
the verified production branding object keeps the favicon exact until the
development bucket is synchronized.

**Why:** The browser needs the same small brand asset in both environments,
but a temporary dev storage outage should not force a different visual identity
or a binary file into the repository.

**How to apply:** Keep the canonical PNG link unchanged, scope the
development-only proxy to that asset path, and retry bucket promotion
separately.