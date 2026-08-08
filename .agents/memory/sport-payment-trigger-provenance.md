---
name: Sport payment trigger provenance
description: The Sport Center payment mirror trigger is verified in the Supabase runtime database, but its DDL is not present in the current repository migration chain.
---

The mirror trigger for confirmed `sport_center.sport_payments` is provisioned by the Sport Center runtime migration and verified in the Supabase development database. A fresh or reset environment still needs the source/public schemas and required columns before provisioning can succeed.

**Why:** The worker intentionally refuses to insert missing mirrors because PostgreSQL is supposed to own them; the migration must therefore recreate the trigger and unique idempotency boundary before the worker starts.

**How to apply:** For future Supabase audits, verify the trigger name, enabled state, `SECURITY DEFINER`, locked `search_path`, unique `public.sport_payments.payment_number`, and source-to-mirror coverage in the target environment. Source review should confirm the provisioning migration, while runtime metadata confirms it was applied.