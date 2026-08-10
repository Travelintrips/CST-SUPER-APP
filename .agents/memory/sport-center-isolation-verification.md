---
name: Sport Center isolation verification boundary
description: Runtime isolation proof must use the app's Supabase development database, not merely a reachable Replit PostgreSQL database.
---

The built-in Replit PostgreSQL database can be reachable while lacking the application's `public` and `sport_center` accounting tables. A runtime isolation proof is therefore blocked unless the configured Supabase development runtime is available and safely identified.

**Why:** The API's development accounting schema and Sport Center source tables live in the application runtime database; connectivity to a different default database does not provide meaningful before/after evidence.

**How to apply:** Verify the target database identity and required tables read-only before creating a test payment. Do not start a migration-running API or mutate data when the target cannot be confirmed.