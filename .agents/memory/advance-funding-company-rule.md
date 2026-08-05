---
name: Advance funding-company rule
description: Durable accounting rule for internal-company cash advances and repayments.
---

For an internal-company cash advance, `source_company_id` is the actual funding company. Once posted, `funding_company_id` is the durable ledger owner for the funding side. The funding company's cash/receivable accounts, AR subledger, and repayment receiver must all be validated and posted against that company; the responsible company's expense/payable/AP side must use `responsible_company_id`.

**Why:** The active workflow company can be the responsible company or an administrative context, so using it as the funding book creates one-sided or misattributed intercompany entries.

**How to apply:** When adding advance, repayment, installment, or reconciliation logic, never infer the funding company from the request context if `funding_company_id`/`source_company_id` is present. Validate both companies and keep both journal legs and subledger updates in the same transaction.