---
name: Safe DEV accounting fixture drift
description: Shared development accounting fixture assumptions can invalidate safe runtime proof without indicating an application failure.
---

The owner-approved SAFE_DEV runtime harness must not assume permanent accounting journal or chart-of-account IDs in the shared development database. A missing hardcoded fixture blocks the proof before its accounting assertions run, even when the database and earlier cleanup checks are healthy. Synthetic portal tenants may also lack seeded journals, so journal-dependent accounting rows must use the selected DEV journal's owner company.

**Why:** Shared development data is mutable and sequence/seed history can change IDs; this produces a proof blocker that is distinct from a product regression.

**How to apply:** Use semantic fixture lookup or a dedicated isolated staging target for accounting-dependent runtime proofs, and bind accounting rows to the selected journal owner when portal tenants are synthetic. Never bypass the production/development safety guard or substitute production data.