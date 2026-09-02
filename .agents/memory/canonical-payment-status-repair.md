---
name: Canonical payment status repair
description: Safe production repair when a canonical payment status is orphaned but mirror triggers protect posted journals.
---

When repairing an orphaned canonical payment status in production, keep all triggers enabled and set the approved transaction-local metadata-correction setting before the source update. The source mirror may refresh non-financial payment metadata on an existing posted journal; it must not create, delete, or financially rewrite a journal.

**Why:** The live `sport_center.sport_payments` update trigger can synchronize payment metadata into a posted accounting journal. Without the transaction-local correction window, the posted-journal guard aborts the repair even when the source status is the only intended change.

**How to apply:** Lock the exact mutation, candidate, and payment set; prove canonical and legacy settlement items are absent; enable only the transaction-local metadata correction setting; update the source status atomically; write an audit row; and verify no settlement or journal was created.

For journal evidence, do not compare `accounting_journals.source_id` numerically to a payment ID: settlement journals use `source_table=payment_settlement_batches` and that ID identifies a batch, not a payment. Use the actual payment/item relationship.