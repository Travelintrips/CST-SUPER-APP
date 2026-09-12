# API Regression Isolation Evidence

**Status:** BLOCKED — isolated Supabase staging is not provisioned  
**Recorded:** 2026-08-16  
**Scope:** `@workspace/api-server` Vitest regression suite and live database
integration scripts

## Disposition of the reported 20 failures

The prior report of 20 API regression failures is retained as
`INVALID_TEST_TARGET_PENDING_ISOLATED_RERUN`. It cannot be used as release
evidence because the then-active suite allowed the shared development/Helium
database through `DATABASE_URL` and `SUPABASE_DATABASE_URL_DEV` fallbacks.

This is an environment-validity reclassification only:

- it does **not** claim the 20 cases pass;
- it does **not** claim the 20 cases are product defects;
- it does **not** authorize production release;
- every affected case must be rerun after staging schema migration.

## Enforced target contract

The regression suite now accepts only `TEST_DATABASE_URL` or
`STAGING_DATABASE_URL`. The target must be a distinct Supabase PostgreSQL
project and must not be:

- the built-in Helium/Replit or a local database;
- the reserved production project;
- the configured development project;
- an alias of `DATABASE_URL`, `SUPABASE_DATABASE_URL_DEV`, or
  `SUPABASE_DATABASE_URL`.

Pure-logic test files remain runnable without a database. Any file that opens a
real PostgreSQL pool or loads the real database client fails closed with an
explicit blocking error when the isolated target is absent or unsafe.

## Acceptance evidence for the next run

The disposition may be replaced only by a retained report showing:

1. the target source (`TEST_DATABASE_URL` or `STAGING_DATABASE_URL`) and
   non-secret Supabase project reference;
2. staging migrations and required seed data applied;
3. all API tests completed with zero failed, pending, and todo tests;
4. all live integration scripts used the same isolated target;
5. cleanup completed and no production or shared-development writes occurred.

No connection string, password, token, or other secret may be written to the
report.