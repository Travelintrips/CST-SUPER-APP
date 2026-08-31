---
name: Startup additive stage for legacy schema
description: Persistent startup registries can skip completed legacy migrations, so later schema repairs need their own stage.
---

When a persistent startup registry may already mark a legacy migration complete, never rely on editing that migration to repair an older runtime schema. Add a separately registered, idempotent additive stage with explicit catalog verification; a version bump is only safe when the registry marker is known to be authoritative. If the repair changes a PostgreSQL `RETURNS TABLE` signature, `CREATE OR REPLACE FUNCTION` cannot change it; use an explicit exact-signature drop/recreate for a state-free helper, or a new versioned function otherwise. Seed stages must not swallow SQL errors, and scope-specific rows require scope-aware uniqueness.

**Why:** A completed legacy vendor-form stage skipped its newer `customer_invoice_links` column work even though the current source contained the correct `CREATE`/`ALTER` statements. A later Customer Portal tax seed also appeared completed while inserting no rows because a legacy unique index omitted the new product scope and the insert error was discarded. The all-services portal proof found the same class of drift on freight ownership/customer columns.

**How to apply:** Give the repair its own stable registry name, register every new server-chain stage before startup, wire it into the standalone development runner, backfill only from canonical parents, update registry contract tests when the stage count changes, and leave unresolved legacy ownership NULL so payment paths remain fail-closed. If a marker unexpectedly reports the target version complete, verify the catalog with a DEV-only runner instead of assuming source execution.