---
name: Runtime test environment
description: Dedicated test/staging is preferred; the owner-approved shared-dev exception is restricted to the standalone SAFE DEV harness.
---

Full runtime verification should use a dedicated `TEST_DATABASE_URL` or `STAGING_DATABASE_URL` plus separate Supabase and storage credentials. When the owner explicitly chooses to use the shared development database instead, only the standalone SAFE DEV harness is allowed: it must verify the development project, use a run ID and dedicated tenants, disable external side effects, and clean up in `finally`.

**Why:** The existing development Supabase project is shared by developers, so write-heavy concurrency, rollback, tenant-isolation, and E2E checks could corrupt real development data or exercise the wrong environment. A controlled owner-approved exception is safer than silently routing tests to production or pretending a dedicated test database exists.

**How to apply:** Prefer provisioning a separate Supabase project/database and synthetic fixtures, then add only the `TEST_*` or `STAGING_*` credentials and run the dedicated migration/runtime gate. For the approved shared-dev exception, run only `pnpm run audit:customer-runtime-dev`; do not boot the API server for write tests, and require post-cleanup verification to report zero remaining run-ID records.