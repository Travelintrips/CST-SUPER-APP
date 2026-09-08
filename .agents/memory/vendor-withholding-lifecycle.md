---
name: Vendor withholding lifecycle
description: Lifecycle boundary between invoice posting, gross AP settlement, withholding liability, and proof receipt.
---

Vendor invoices may use an automatically mapped, company-scoped withholding liability account without a separate Finance review. Bank reconciliation may settle those invoices directly: partial cash reduces AP by cash paid; a full net settlement debits AP gross, credits Bank net, and credits each mapped PPh liability. A withholding certificate remains separate evidence when required.

**Why:** The owner wants bank mutations to be the payment evidence and does not want auto-resolved PPh to block candidates. Treating a net bank mutation as gross AP makes the journal unbalanced, while applying the full PPh amount to a partial cash payment recognizes tax prematurely.

**How to apply:** Preserve gross invoice/AP recognition. Allow only mapped liability COAs to participate in the automatic path; fail closed if a full-net settlement has no liability account. Detect full net settlement as `cash = outstanding - withholding`; only then credit PPh and increase gross AP settlement. For partial cash, debit AP and credit Bank by the mutation amount without recognizing the full withholding amount prematurely. Keep Bank Disbursement available for explicit tax-certificate workflows.
