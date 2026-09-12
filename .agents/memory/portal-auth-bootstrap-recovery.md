---
name: Portal auth bootstrap recovery
description: Session recovery when the HttpOnly portal cookie survives but the readable hint cookie is absent.
---

The canonical `/api/portal/auth/bootstrap` response must remain the authority for portal UI session recovery; a missing readable hint cookie must not make a valid HttpOnly session appear logged out.

**Why:** Older or partially migrated sessions can retain the server session without `portal_session_hint`, leaving users on `/login` or hiding protected history even though the backend still authenticates them.

**How to apply:** Let `/login` probe the canonical bootstrap endpoint, let protected route guards await that same cached result, and keep protected APIs responsible for final authorization.