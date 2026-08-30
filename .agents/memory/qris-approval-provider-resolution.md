---
name: QRIS approval provider resolution
description: Rules for approving QRIS Sport Center settlements when payment metadata is incomplete.
---

QRIS approval may resolve missing payment provider, bank account, settlement date, and rule version from bank evidence plus exactly one owner-approved settlement configuration. Missing metadata is incomplete state; explicit conflicting metadata remains fail-closed, and InhouseTrf evidence remains blocked.

**Why:** Historical Sport Center payments can have NULL provider or canonical-group metadata even when the bank amount, MDR, company, and H-1 payment cohort are valid. Requiring those fields to have been pre-populated creates false approval blocks, while trusting stale candidate metadata can misclassify ordinary bank transfers.

**How to apply:** Resolve and validate inside the approval transaction, materialize only missing/unknown metadata before the canonical settlement builder runs, preserve company/date/amount/already-reconciled guards, and keep ordinary InhouseTrf transfers outside the QRIS path.