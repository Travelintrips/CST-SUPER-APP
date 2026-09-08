---
name: Vendor invoice bank settlement
description: Bank mutations settling posted vendor invoices must clear AP rather than reclassify expense.
---

Posted vendor invoices already recognize the expense and credit AP. A bank mutation matched to that invoice must debit AP and credit bank, while updating the invoice payment balance atomically.

**Why:** Sending an invoice payment through generic manual COA approval can recognize the same expense twice and leave the vendor invoice unpaid.

**How to apply:** Keep vendor-invoice settlement separate from generic COA mapping, validate company/invoice/payment identity under row locks, and route withholding-tax cases through the gross-AP/net-bank disbursement flow.

For a vendor invoice that is already fully paid, bank reconciliation must use a link-only path when the mutation exactly matches an existing posted Bank Disbursement item. That path must not create a journal or increment `amount_paid`; a new payment path remains reserved for positive outstanding balances.

**Why:** Split payments can make the aggregate invoice balance zero before each bank mutation has been linked to its corresponding posted disbursement. Treating the final link as another payment creates duplicate AP settlement and blocks valid reconciliation.

**How to apply:** Require company-scoped, posted disbursement evidence and an unused exact item/amount match under row locks; record an approved reconciliation match and audit event, then mark only the bank mutation reconciled.