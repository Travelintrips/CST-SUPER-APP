---
name: Sprint 09A runtime migration
description: Runtime Supabase snapshots may lack legacy primary-key constraints required by new handoff foreign keys.
---

When adding a foreign key to an existing runtime table, verify that the referenced column is actually backed by a primary key or unique constraint, not only by the application schema definition. Add an idempotent compatibility constraint before creating the FK when older snapshots are missing it.

**Why:** The development Supabase snapshot had `payment_requests.id` as a non-null serial column without a primary key, so the Sprint 09A handoff FK failed even though the Drizzle schema declared a primary key.

**How to apply:** Inspect `pg_constraint` on the target development database before applying additive FKs; keep compatibility repairs idempotent and never delete or rewrite existing rows.