---
name: Reconciliation source uniqueness
description: The invariant that one source transaction cannot be reconciled to multiple accounting lines.
---

An accounting reconciliation source must be unique per company while its reconciliation is `reconciled`. The invariant belongs in the database as well as in application matching logic.

**Why:** UI checks and in-memory auto-match claims do not protect against two concurrent requests, retries, or manual/API writes assigning the same payment to different ledger lines.

**How to apply:** Keep a partial unique index over company and source identity for reconciled rows, and treat a conflict/no-op as a skipped auto-match rather than reporting a false match.