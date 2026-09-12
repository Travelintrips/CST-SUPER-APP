---
name: DB connection string order (lib/db)
description: SUPABASE_PG_URL can have stale/wrong credentials; both dev AND prod must prefer SUPABASE_DATABASE_URL before SUPABASE_PG_URL to avoid ECIRCUITBREAKER cascade.
---

## Rule
In `lib/db/src/index.ts`, URL candidates must resolve in this order:

**Production:**
1. `SUPABASE_DATABASE_URL`
2. `SUPABASE_PG_URL`
3. `DATABASE_URL`

**Development:**
1. `SUPABASE_DATABASE_URL_DEV`
2. `SUPABASE_DATABASE_URL`
3. `SUPABASE_PG_URL`
4. `DATABASE_URL`

**Why:** `SUPABASE_PG_URL` can hold outdated/expired credentials. If it is picked before `SUPABASE_DATABASE_URL`, every pool connection attempt fails with "password authentication failed for user postgres". Supabase pgBouncer then blocks all new connections with ECIRCUITBREAKER ("too many authentication failures, new connections are temporarily blocked"), making ALL services appear broken — even those that would have used the correct credentials. This was confirmed in production: ECIRCUITBREAKER lasted 4+ minutes after every deployment because `SUPABASE_PG_URL` was listed first in the production candidates array.

**How to apply:** Any time login or DB queries fail with `ECIRCUITBREAKER` or "Failed query" across the board, check whether `SUPABASE_PG_URL` was resolved first. Swap the order in `lib/db/src/index.ts` if needed. Symptom confirmation: deployment logs show "password authentication failed for user postgres" in the first few seconds, then `ECIRCUITBREAKER` cascade for minutes after.
