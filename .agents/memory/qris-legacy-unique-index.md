---
name: QRIS legacy unique index
description: Legacy QRIS candidate schemas may retain a standalone unique index after the matching constraint is removed.
---

When allowing historical QRIS candidate snapshots per bank mutation, remove both the legacy constraint and any standalone index with the old unique-index name.

**Why:** Dropping a constraint does not remove an independently-created unique index, so superseded candidate regeneration can still fail with duplicate-key errors.

**How to apply:** Keep the cleanup idempotent in the QRIS migration and verify `pg_indexes` as well as `pg_constraint` on older production schemas.