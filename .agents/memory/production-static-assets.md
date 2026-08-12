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