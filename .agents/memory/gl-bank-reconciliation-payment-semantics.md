---
name: GL bank reconciliation payment semantics
description: Vendor payments posted directly from bank reconciliation need canonical module and payment-method evidence in General Ledger.
---

General Ledger must present a vendor payment from bank reconciliation as bank-reconciliation activity and as a bank transfer when the linked bank mutation is the only payment evidence.

**Why:** The direct reconciliation posting path can create a balanced journal without an `accounting_payments` bridge. Treating the missing bridge as “no payment method” hides a valid posted payment from ordinary user filters and makes a gross vendor-liability debit look unrelated to the net bank credit.

**How to apply:** Normalize only the bank-reconciliation vendor-payment origin for the module filter, and use the linked bank mutation as the fallback payment-method evidence. Keep the journal gross/net accounting unchanged.