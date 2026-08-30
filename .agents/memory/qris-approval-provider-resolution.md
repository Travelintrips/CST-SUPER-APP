---
name: QRIS approval provider resolution
description: Rules for approving QRIS Sport Center settlements when payment metadata is incomplete.
---

QRIS Bank Reconciliation auto-match is decided by live QRIS payment method, confirmed payment status, H-1 calendar date from `paid_at`, exact canonical-MDR net, and company equality. Provider, group, account, direction, rail labels, and stale metadata are not auto-match blockers. Only the resulting MATCHED row enters the separate journal/settlement approval flow.

**Why:** Legacy or ambiguous metadata can reject an otherwise provable exact settlement. The canonical monetary result is authoritative; failed or pending rows must not become visible QRIS candidates.

**How to apply:** Auto-match only confirmed, unreconciled source payments whose `paid_at` date and exact MDR net match the bank row. Keep settlement construction and ledger approval separate; recheck live payment state before posting and derive posting dimensions from owner configuration, not `canonical_group`.