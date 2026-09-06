---
name: Vendor invoice bank settlement
description: Bank mutations settling posted vendor invoices must clear AP rather than reclassify expense.
---

Posted vendor invoices already recognize the expense and credit AP. A bank mutation matched to that invoice must debit AP and credit bank, while updating the invoice payment balance atomically.

**Why:** Sending an invoice payment through generic manual COA approval can recognize the same expense twice and leave the vendor invoice unpaid.

**How to apply:** Keep vendor-invoice settlement separate from generic COA mapping, validate company/invoice/payment identity under row locks, and route withholding-tax cases through the gross-AP/net-bank disbursement flow.