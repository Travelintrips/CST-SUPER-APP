---
name: Customer Portal runtime proofs
description: The required environment path for one-off Customer Portal lifecycle proofs.
---

Run one-off Customer Portal lifecycle proofs through the official development Secret Manager loader so `SUPABASE_DATABASE_URL_DEV` is injected before the harness starts.

**Why:** A direct Node process may not inherit the workflow's loaded bundle and can fall back to a local database that lacks the portal schema, producing a misleading missing-relation failure.

**How to apply:** Keep the proof development-only, load the development bundle first, and verify readiness plus cleanup before treating the result as evidence.