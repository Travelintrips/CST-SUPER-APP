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
Reconciliation governance is candidate-first: use invoice matching only when a valid
vendor-invoice candidate exists; otherwise let the admin classify the bank mutation
through COA selection or Rule AI.

**Why:** A missing outstanding invoice is not evidence that the bank mutation should
be forced into AP settlement. Forcing the invoice dialog can hide the correct
no-candidate accounting path and risks duplicating an already-posted expense or AP.

**How to apply:** Keep the no-candidate path available for COA/Rule AI. In the
bank-reconciliation dialog, an outstanding invoice may use Match & Bayar; an
already-paid invoice may appear only when it has no active vendor-invoice
settlement match, and must use a reconciliation-only Link Settlement path that
does not create a journal or increment amount_paid.

**Why:** A valid Bank Disbursement can settle the invoice financially before a
bank mutation is linked. Hiding that invoice forever loses settlement evidence,
while treating the link as a new payment double-settles AP.

For a bank mutation that covers several vendor invoices, the reviewer may select
multiple positive-outstanding invoices, but the selected allocation must equal the
mutation exactly (with a single invoice allowed to receive a partial payment).
The settlement is one atomic AP-debit/bank-credit journal and updates every
invoice under row locks.

**Why:** A checkbox list is only safe when the UI total and the backend total use
the same outstanding-balance contract; separate sequential payments can race or
leave a bank mutation partially accounted.

**How to apply:** Keep batch selection company-scoped, reject fully settled or
withholding-review invoices, lock the mutation and invoices in one transaction,
and create one approved reconciliation match carrying the batch identity.
