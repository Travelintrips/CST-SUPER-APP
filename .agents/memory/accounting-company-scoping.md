---
name: Accounting company scoping uses accounting_entries, not the lines table
description: accounting_entry_lines has no company_id; multi-company filters must go through accounting_entries
---

In the accounting schema, `accounting_entry_lines` (commonly aliased `ael`) has only
id, entry_id, account_id, description, debit, credit. It has **no** `company_id`.
Company scoping lives on `accounting_entries` (aliased `ae`) as `ae.company_id`.

**Why:** Several report queries (dashboard-kpi, consolidated multi-company P&L /
cashflow) referenced `ael.company_id`, throwing `column ael.company_id does not exist`
and 500-ing the endpoint. The line row carries no company.

**How to apply:** Any company filter / GROUP BY / SELECT in accounting reports must use
`ae.company_id` and JOIN `accounting_entries ae ON ae.id = ael.entry_id`. Never assume
the line table is company-scoped.
