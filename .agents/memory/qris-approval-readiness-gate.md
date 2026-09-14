---
name: QRIS approval readiness gate
description: Distinguish reviewable QRIS evidence from payment data that is safe to approve.
---

QRIS evidence may remain visible for review while approval readiness is false. A mutation is approval-ready only when its candidate has a non-empty payment set and every live source payment is confirmed, QRIS, and unsettled.

**Why:** Pending, stale, already-settled, or empty payment snapshots can otherwise project as `matched` and expose an approval path that the canonical settlement builder will reject.

**How to apply:** Keep source-candidate visibility permissive enough for audit/review, but apply the stricter confirmed-and-unsettled predicate to effective status, summary counts, and approval actions. Stale QRIS evidence must not reopen generic COA approval.