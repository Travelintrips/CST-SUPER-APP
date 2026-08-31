---
name: QRIS approval provider resolution
description: Rules for approving QRIS Sport Center settlements when payment metadata is incomplete.
---

QRIS Bank Reconciliation auto-match is decided by live QRIS payment method, confirmed payment status, H-1 calendar date from `paid_at`, exact canonical-MDR net, and company equality. Provider, group, account, direction, rail labels, and stale metadata are not auto-match blockers. Only the resulting MATCHED row enters the separate journal/settlement approval flow.

**Why:** Legacy or ambiguous metadata can reject an otherwise provable exact settlement. The canonical monetary result is authoritative; failed or pending rows must not become visible QRIS candidates.

**How to apply:** Auto-match only confirmed, unreconciled source payments whose `paid_at` date and exact MDR net match the bank row. Keep settlement construction and ledger approval separate; recheck live payment state before posting and derive posting dimensions from owner configuration, not `canonical_group`.

Candidate generation must fall back to the active owner-approved settlement calculator when a confirmed payment still stores `mdr_amount = 0`; an explicit provider on the payment source may identify the candidate for display even when the bank-side label is generic.

**Why:** A production Mandiri batch had an exact 0.7% bank deduction while all source rows still held zero MDR, causing a false `UNMATCHED` result and an unrelated “provider unknown” label.

**How to apply:** Resolve the active company/provider/account config for the H+1 date, calculate deductions with the canonical database function, and keep payment-source provider identity separate from bank-evidence detection.