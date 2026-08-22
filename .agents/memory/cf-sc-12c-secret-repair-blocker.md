---
name: CF-SC-12C production secret repair boundary
description: Production bundle repair can pass parsing while the official CF-SC-12C guard still requires an approved direct migration URL.
---

The production Secret Manager service account may access `latest` and add a
version without having permission to list versions; historical versions may
also be unavailable. A repaired bundle must still contain the canonical direct
production migration URL required by the CF-SC-12C target-separation guard.

**Why:** The pooler URL alone does not prove the Supabase production project
identity used by the recovery runner, and deriving or guessing a direct URL
would weaken the fail-closed production boundary.

**How to apply:** After a managed JSON repair, validate the official loader and
the runner's exact target guard separately. If the direct migration URL is
missing and no approved source exists, stop before the startup stage and keep
the marker/readiness result blocked.