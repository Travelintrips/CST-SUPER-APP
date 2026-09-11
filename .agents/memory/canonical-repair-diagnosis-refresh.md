---
name: Canonical repair diagnosis refresh
description: Repair diagnostics must re-read canonical ownership and journal state after admin repair.
---

Canonical repair diagnosis must classify the current database state from the bank mutation, source-aware approved match, canonical settlement batch, and settlement journal. Persisted auto-post details and rejected provisional candidate snapshots are historical evidence only.

**Why:** Admin SQL or controlled repair can make ownership valid while cached diagnostics still report `FINANCIAL_STATE_REQUIRES_REVIEW`, causing a stale developer-action card and misleading operators.

**How to apply:** Use no-store/fresh reads, invalidate derived UI queries after repair, and expose `CANONICAL_STATE_VALID` only when exact ownership, date/amount, and posted journal invariants pass. Keep all conflicts fail-closed.