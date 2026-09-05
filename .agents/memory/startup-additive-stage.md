---
name: Startup additive stage for legacy schema
description: Persistent startup registries can skip completed legacy migrations, so later schema repairs need their own stage.
---

When a persistent startup registry may already mark a legacy migration complete, never rely on editing that migration to repair an older runtime schema. Add a separately registered, idempotent additive stage with explicit catalog verification; a version bump is only safe when the registry marker is known to be authoritative. If the repair changes a PostgreSQL `RETURNS TABLE` signature, `CREATE OR REPLACE FUNCTION` cannot change it; use an explicit exact-signature drop/recreate for a state-free helper, or a new versioned function otherwise. Seed stages must not swallow SQL errors, and scope-specific rows require scope-aware uniqueness.

**Why:** A completed legacy vendor-form stage skipped its newer `customer_invoice_links` column work even though the current source contained the correct `CREATE`/`ALTER` statements. A later Customer Portal tax seed also appeared completed while inserting no rows because a legacy unique index omitted the new product scope and the insert error was discarded. The all-services portal proof found the same class of drift on freight ownership/customer columns.

**How to apply:** Give the repair its own stable registry name, register every new server-chain stage before startup, wire it into the standalone development runner, backfill only from canonical parents, update registry contract tests when the stage count changes, and leave unresolved legacy ownership NULL so payment paths remain fail-closed. If a marker unexpectedly reports the target version complete, verify the catalog with a DEV-only runner instead of assuming source execution.

Schema required by an active write endpoint must not be installed by fire-and-forget DDL in the route module. Run and await a small idempotent catalog repair before the API is marked ready, outside any stale completion marker that could skip it.

**Why:** Production accepted OCR Vendor Invoice requests while its route-level DDL had failed as a warning, leaving tax-review columns absent and every invoice insert failing at runtime.

**How to apply:** Centralize the required columns in the authoritative migration, run its minimal compatibility subset as a fail-closed pre-start substep, and remove duplicate asynchronous route-level DDL.

The persistent gate resolves server-chain stages by their exact display name, so adding a migration function and chaining its call is insufficient unless the matching registry row is also present.

**Why:** An unregistered display name fails closed before the migration callback runs, leaving the API unready even when the migration implementation itself is valid.

**How to apply:** Add the stable machine name and exact display name to the registry in the same change as the chain call, and cover both names with a registry contract test.