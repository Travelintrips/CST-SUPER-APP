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

**How to apply:** Keep the no-candidate path available for COA/Rule AI, and treat
the vendor-invoice dialog as a separate allocation flow that requires an actually
outstanding invoice in the active company.