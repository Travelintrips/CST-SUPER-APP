---
name: Vendor invoice payment correction
description: Safe boundary for restoring an incorrectly settled vendor invoice to unpaid
---

Resetting a vendor invoice to unpaid is safe only when every approved vendor-invoice match is an orphaned settlement: no linked payment journal, no active/posted bank mutation, and the mutation total exactly equals `amount_paid`. Otherwise use bank-reconciliation reversal first.

**Why:** Directly setting `amount_paid` to zero can leave bank journals, approved matches, and AP balances disagreeing; production corrections must remain auditable and fail closed.

**How to apply:** Require an admin reason, lock the invoice and settlement rows in one transaction, reject the affected match evidence rather than delete it, write reconciliation plus unified audit entries, then set the invoice payment amount to zero while preserving the posted purchase journal.