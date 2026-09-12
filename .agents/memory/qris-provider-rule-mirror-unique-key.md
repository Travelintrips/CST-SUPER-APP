---
name: QRIS provider mirror unique key
description: Legacy public QRIS rule mirror uniqueness omits effective_until
---

The legacy public QRIS rule mirror is unique by company, internal bank account, provider, effective_from, and rule_version; it does not include effective_until.

**Why:** A stale mirror with the same rule identity cannot be repaired by inserting a second row. The existing row's effective boundary must be reconciled only after proving exactly one canonical owner-approved source row owns that identity.

**How to apply:** In guarded repairs and runtime synchronization, reconcile the effective boundary before the insert-if-missing step, then synchronize `is_active` and deactivate source-owned orphan snapshots. Keep unrelated providers and non-Sport-Center sources untouched.