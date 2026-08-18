---
name: Startup additive stage for legacy schema
description: Persistent startup registries can skip completed legacy migrations, so later schema repairs need their own stage.
---

When a persistent startup registry may already mark a legacy migration complete, never rely on editing that migration to repair an older runtime schema. Add a separately registered, idempotent additive stage with explicit catalog verification.

**Why:** A completed legacy vendor-form stage skipped its newer `customer_invoice_links` column work even though the current source contained the correct `CREATE`/`ALTER` statements.

**How to apply:** Give the repair its own stable registry name, wire it into both the server chain and standalone development runner, backfill only from canonical parents, update registry contract tests when the stage count changes, and leave unresolved legacy ownership NULL so payment paths remain fail-closed.