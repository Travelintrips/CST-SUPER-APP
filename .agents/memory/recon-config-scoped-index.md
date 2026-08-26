---
name: Recon config scoped index
description: Prevents the Bank Reconciliation Configuration mirror from failing on legacy index definitions.
---

Bank Reconciliation Configuration must enforce uniqueness by `code` within the normalized company scope, including the shared/null-company scope. Its `ON CONFLICT` target is `(code, COALESCE(company_id, 0))`.

**Why:** A legacy production index retained the old name but enforced only global `code` uniqueness. PostgreSQL could not infer it for the scoped `ON CONFLICT` target, so configuration seeding aborted and operational `recon_rules` remained invisible in the Rule AI workspace.

**How to apply:** Create the new scoped unique index under a distinct name before removing the legacy index. Backfill operational rules with a normalized distinct set of company, direction, condition, and COA values so duplicate source rules cannot update one mirror row twice in a single insert.