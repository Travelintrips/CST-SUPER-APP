---
name: Vendor invoice bank settlement
description: Bank mutations settling posted vendor invoices must clear AP rather than reclassify expense.
---

Posted vendor invoices already recognize the expense and credit AP. A bank mutation matched to that invoice must debit AP and credit bank, while updating the invoice payment balance atomically.

**Why:** Sending an invoice payment through generic manual COA approval can recognize the same expense twice and leave the vendor invoice unpaid.

**How to apply:** Keep vendor-invoice settlement separate from generic COA mapping, validate company/invoice/payment identity under row locks, and route withholding-tax cases through the gross-AP/net-bank disbursement flow.

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