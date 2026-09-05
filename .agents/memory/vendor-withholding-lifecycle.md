---
name: Vendor withholding lifecycle
description: Lifecycle boundary between invoice posting, gross AP settlement, withholding liability, and proof receipt.
---

Vendor invoices may be posted after per-line withholding review creates a `proof_pending` record; proof receipt is required before the invoice can become fully settled/paid. In the bank-disbursement API, `paymentAmount` is the net cash amount; the gross AP settlement is `paymentAmount + whtAmount`.

**Why:** The owner policy allows AP recognition before the withholding certificate exists, but does not allow the tax obligation or settlement evidence to disappear. Treating `paymentAmount` as gross makes the payment journal unbalanced by subtracting withholding twice.

**How to apply:** Post invoice gross (line COAs plus input VAT against AP gross). At disbursement, debit AP gross, credit bank by the supplied net `paymentAmount`, credit each reviewed withholding liability, and keep the invoice `posted` until every withholding record reaches `proof_received`.