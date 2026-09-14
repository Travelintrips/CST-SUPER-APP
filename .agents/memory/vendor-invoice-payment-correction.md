---
name: Vendor invoice payment correction
description: Safe boundaries for net-withholding settlement normalization and restoring incorrectly settled vendor invoices
---

When a vendor invoice's persisted cash payment is net of withholding, promote it to gross settlement only when the exact remaining balance equals the persisted withholding amount and an approved OUT reconciliation match has a linked posted, balanced accounting journal. A draft journal is not settlement evidence. Never create another bank movement or journal for this correction.

**Why:** A net transfer plus withheld PPh can fully settle the supplier liability, but matching or draft-journal creation alone must not turn an unrelated partial payment into a paid invoice or make the invoice appear settled before the ledger is visible.

**How to apply:** Keep payment-status recalculation and the reconciliation-sync action evidence-gated; update invoice payment totals after the linked bank-reconciliation journal is promoted to `posted`, and retain the existing withholding-proof requirement before final status becomes `paid`.

Resetting a vendor invoice to unpaid is safe only when every approved vendor-invoice match is an orphaned settlement: no linked payment journal, no active/posted bank mutation, and the mutation total exactly equals `amount_paid`. Otherwise use bank-reconciliation reversal first.

**Why:** Directly setting `amount_paid` to zero can leave bank journals, approved matches, and AP balances disagreeing; production corrections must remain auditable and fail closed.

**How to apply:** Require an admin reason, lock the invoice and settlement rows in one transaction, reject the affected match evidence rather than delete it, write reconciliation plus unified audit entries, then set the invoice payment amount to zero while preserving the posted purchase journal.

Gross-settlement recalculation must compare the net cash payment with the pre-payment outstanding balance; passing the post-payment residual makes an exact net-plus-withholding settlement fail to promote.

**Why:** A vendor invoice can persist net cash in `amount_paid` while the remaining AP balance equals withholding; using that residual as the comparison baseline hides a valid gross settlement.

**How to apply:** Preserve the pre-payment outstanding amount when calling settlement inference, and keep the approved OUT mutation plus journal-evidence gate and withholding-proof gate independent.