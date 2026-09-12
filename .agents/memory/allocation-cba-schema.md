---
name: Allocation Engine — company_bank_accounts schema
description: Column names in company_bank_accounts that affect allocation GET /:id JOIN
---

`company_bank_accounts` table has: `bank_name`, `account_number`, `account_type`.
It does NOT have `account_name`.

When writing JOINs from `allocation_headers` to `company_bank_accounts`, only select:
- `cba.bank_name`
- `cba.account_number`

**Why:** Selecting `cba.account_name` causes a 500 on GET /allocation/:id (column does not exist error).

**How to apply:** Any route that JOINs allocation_headers with company_bank_accounts must avoid `account_name`.
