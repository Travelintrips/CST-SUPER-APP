---
name: Customer Portal Google OAuth
description: Authentication boundary for Google login on the public customer portal.
---

Public Customer Portal Google login must use the API's Google OAuth flow and finish with a portal JWT plus `portal_session` cookie. It must not depend on Supabase Auth's external-provider code exchange.

**Why:** The production Supabase project returned `unexpected_failure` while exchanging Google's external authorization code, while the API already had a verified Google OAuth client and a registered callback path.

**How to apply:** Keep the customer-facing flow on the backend Google callback and create/update `portal_customers` there. For public requests from `cstlogistic.co.id`, use that verified host for the callback instead of a stale `.replit.app` override. Treat Supabase OAuth as a separate flow for components that explicitly need a Supabase session, not as the public portal login dependency.

**Operational note:** After changing callback-origin routing, the public deployment must be republished; a running preview can generate the correct URI while the live custom domain continues serving the previous deployment.

**Production state rule:** OAuth state storage must fail closed when the shared DB is unavailable; never rely on an in-memory fallback in a production deployment that may route authorization and callback requests to different instances.

**Why:** An in-memory state fallback can make the authorization request succeed but cause the callback to report `STATE_INVALID` when it lands on another autoscaled instance, hiding the underlying storage outage.

**How to apply:** Keep memory fallback limited to development. In production, classify save/consume storage errors separately from invalid or expired state and emit a sanitized `STATE_STORAGE_FAILURE` trace.