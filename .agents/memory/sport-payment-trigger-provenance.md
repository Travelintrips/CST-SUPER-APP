---
name: Sport payment trigger provenance
description: The Sport Center payment mirror trigger is verified in the Supabase runtime database, but its DDL is not present in the current repository migration chain.
---

The mirror trigger for confirmed `sport_center.sport_payments` is a runtime database object, not a repository-managed migration in the current codebase. A fresh or reset environment must explicitly verify or provision this object before enabling the incremental worker contract.

**Why:** The worker intentionally refuses to insert missing mirrors because PostgreSQL is supposed to own them; source-only review can therefore miss a runtime dependency and report a false sense of completeness.

**How to apply:** For future Supabase audits, verify the trigger name, enabled state, `SECURITY DEFINER`, locked `search_path`, unique `public.sport_payments.payment_number`, and source-to-mirror coverage in the target environment. Do not treat source grep alone as proof.