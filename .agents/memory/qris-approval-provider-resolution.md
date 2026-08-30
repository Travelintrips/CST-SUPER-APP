---
name: QRIS approval provider resolution
description: Rules for approving QRIS Sport Center settlements when payment metadata is incomplete.
---

QRIS Bank Reconciliation approval is decided by live QRIS payment method, confirmed payment status, H-1 calendar date, exact canonical-MDR net, company equality, and unreconciled/duplicate state. Provider, group, account, direction, rail labels, candidate status, and stale snapshots are not business blockers. Pending payments may remain visible as evidence, but make the entire candidate non-approvable until every selected batch payment is confirmed.

**Why:** Legacy or ambiguous metadata can reject an otherwise provable exact settlement. The canonical monetary result is authoritative; metadata uniqueness is not.

**How to apply:** For manual QRIS approval, treat the selected confirmed and unreconciled payment IDs as authoritative. Fail before settlement construction when any payment is missing or not confirmed. Derive posting dimensions from the exact-net owner config—not from canonical_group or the source payment’s group—and recheck the live rule under lock.