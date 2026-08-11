---
name: Sport Center isolation verification boundary
description: Runtime isolation proof must use the app's Supabase development database, not merely a reachable Replit PostgreSQL database.
---

The built-in Replit PostgreSQL database can be reachable while lacking the application's `public` and `sport_center` accounting tables. A runtime isolation proof is therefore blocked unless the configured Supabase development runtime is available and safely identified.

**Why:** The API's development accounting schema and Sport Center source tables live in the application runtime database; connectivity to a different default database does not provide meaningful before/after evidence.

**How to apply:** Verify the target database identity and required tables read-only before creating a test payment. Do not start a migration-running API or mutate data when the target cannot be confirmed.

When the Supabase development URL is unavailable and only the built-in Replit `DATABASE_URL` is present, classify the runtime proof as blocked rather than substituting the reachable database. Static source review can identify ownership and migration proposals, but cannot certify live column types, trigger definitions, bridge rows, or payment/journal state.

**Why:** A reachable database with the wrong schema can make a trigger or payment-flow repair appear validated while providing no evidence about the application's Sport Center runtime.

**How to apply:** Stop before source changes that depend on live target columns, report `4C-7A PARTIAL — MIGRATION APPROVAL REQUIRED`, and wait for an explicitly identified development Supabase target.