---
name: Reconciliation account mapping
description: Rules for selecting the contra account when approving bank reconciliation entries
---

Direct bank outflows must resolve to an expense COA, with bank administration fees using the company-specific `5-3010` account. AP is reserved for an explicitly selected vendor or accounting payment; inbound invoice receipts use AR; inbound Sport Center payments use Sport Center revenue when no posted source journal is reused; internal transfers use the other bank/cash asset.

**Why:** A generic OUT-to-AP fallback caused bank administration fees and ordinary expenses to be posted as payables, while already-posted module payments could create duplicate bank journals.

**How to apply:** Keep candidate selection and approval scoped by mutation direction/company, lock the persisted match row during approval, and reuse a posted source journal for Sport Center/accounting payments instead of posting a second entry.