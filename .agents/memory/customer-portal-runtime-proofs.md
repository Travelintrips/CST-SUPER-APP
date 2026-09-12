---
name: Customer Portal runtime proofs
description: The required environment path for one-off Customer Portal lifecycle proofs.
---

Run one-off Customer Portal lifecycle proofs through the official development Secret Manager loader so `SUPABASE_DATABASE_URL_DEV` is injected before the harness starts.

**Why:** A direct Node process may not inherit the workflow's loaded bundle and can fall back to a local database that lacks the portal schema, producing a misleading missing-relation failure.

**How to apply:** Keep the proof development-only, load the development bundle first, and verify readiness plus cleanup before treating the result as evidence.

Company-scope proofs must restart the API process (or explicitly invalidate its user-context cache) after changing an admin fixture's company or allowed-company rows; setting the database alone can leave a stale all-company context in memory.

**Why:** The auth middleware caches company scope in-process, so a session that was valid before fixture scoping can make cross-company endpoints appear allowed even though the database rows are correct.

**How to apply:** Run the scope proof against a fresh DEV API process with `CUSTOMER_PORTAL_FINANCE_MODE=shadow` set on that process, not only on the runner, and keep all outbound safe flags enabled.