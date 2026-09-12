---
name: Production database URL selection
description: Production approvals and maintenance must resolve the canonical application database URL, never silently fall back to a migration endpoint.
---

Production database resolution is canonical-first: require `SUPABASE_DATABASE_URL` and never select `SUPABASE_MIGRATION_URL` implicitly. A migration URL may coexist for other tooling, including with a different pooler/direct connection path, but it must not redirect approval or maintenance scripts.

**Why:** The production secret bundle can expose both URLs for the same Supabase project while their connection paths differ. Preferring the migration URL can send governance writes to an unexpected endpoint.

**How to apply:** Route approval and maintenance scripts through the shared resolver; fail closed when the canonical production URL is missing or malformed. Validate the loader before spawning a production child process.