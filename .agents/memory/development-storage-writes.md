---
name: Development Storage writes
description: Boundary between safe development previews and real Supabase Storage uploads.
---

Safe development mode must remain fail-closed for WhatsApp, email, payments, webhooks, and arbitrary external HTTP, but authenticated media uploads in the development preview need real Storage bytes. Otherwise a route can persist database metadata while the browser receives a successful response for an object that does not exist.

**Why:** The development workflow enables safe mode by default, and the old Storage short-circuit returned success without writing the object. Image Manager and CMS previews then showed broken images even though their database rows were present.

**How to apply:** Permit Storage API requests only to the configured development Supabase origin when the explicit dev-storage flag is enabled; keep E2E mode fail-closed and never allow the production origin through the development exception.