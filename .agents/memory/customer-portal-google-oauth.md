---
name: Customer Portal Google OAuth
description: Authentication boundary for Google login on the public customer portal.
---

Public Customer Portal Google login must use the API's Google OAuth flow and finish with a portal JWT plus `portal_session` cookie. It must not depend on Supabase Auth's external-provider code exchange.

**Why:** The production Supabase project returned `unexpected_failure` while exchanging Google's external authorization code, while the API already had a verified Google OAuth client and a registered callback path.

**How to apply:** Keep the customer-facing flow on the backend Google callback and create/update `portal_customers` there. Treat Supabase OAuth as a separate flow for components that explicitly need a Supabase session, not as the public portal login dependency.