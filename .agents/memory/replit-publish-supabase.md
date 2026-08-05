---
name: Replit publish with external Supabase
description: Projects whose runtime database is Supabase should not enable Replit PostgreSQL just to satisfy publish-time schema validation.
---

## Rule

When a project’s application database is an external Supabase instance, keep the Replit PostgreSQL module disabled unless the project intentionally uses Replit-managed PostgreSQL. An accidentally enabled `postgresql-*` module can provision an unrelated Replit database and make Publish stop during automatic schema migration validation.

**Why:** The CST Super App uses separate Supabase development and production databases. Enabling Replit PostgreSQL created an unrelated empty development database, so Publish compared the wrong schema and failed before the application build.

**How to apply:** Check `.replit` modules and the project’s DB connection resolver together before diagnosing Publish schema conflicts. Do not choose “copy development database to production” or manually alter production data as a workaround; remove the unused Replit database module and retry Publish.