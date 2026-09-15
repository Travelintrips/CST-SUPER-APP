---
name: QRIS approval readiness gate
description: Distinguish reviewable QRIS evidence from payment data that is safe to approve.
---

QRIS evidence may remain visible for review while approval readiness is false. A mutation is approval-ready only when its candidate has a non-empty payment set and every live source payment is confirmed, QRIS, and unsettled.

**Why:** Pending, stale, already-settled, or empty payment snapshots can otherwise project as `matched` and expose an approval path that the canonical settlement builder will reject.

**How to apply:** Keep source-candidate visibility permissive enough for audit/review, but apply the stricter confirmed-and-unsettled predicate to effective status, summary counts, and approval actions. Stale QRIS evidence must not reopen generic COA approval.

The `qris_mutation_batch_candidates.id` is a snapshot identity, not a canonical
settlement batch ID or a Sport Center payment ID. Candidate generation must
never project that ID into `bank_reconciliation_matches` or advance the bank
mutation lifecycle; only the source-aware canonical path may create an
approved match after a posted settlement journal is proven.

**Why:** A production snapshot was previously persisted as an approved
`qris_settlement` match with source `sport_center.sport_payments`, even though
the referenced ID was the snapshot row and no canonical batch or settlement
journal existed.

**How to apply:** Treat snapshot generation as read/review evidence. Resolve
canonical payment membership and batch identity first, then let the owner
approval/recovery routine create the canonical link.