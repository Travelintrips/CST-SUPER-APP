---
name: Accounting tax deduplication FK safety
description: Tax seed deduplication must reconcile transaction_taxes references before removing duplicate tax rows.
---

Accounting tax deduplication must preserve the transaction_taxes foreign key:
remove duplicate assignments when the canonical tax is already assigned to the
same transaction, redirect other references to the canonical tax, then remove
the duplicate row.

**Why:** Production startup failed when a legacy tax deduplication DELETE hit
transaction_taxes_tax_id_fkey.

**How to apply:** Any future tax seed cleanup must reconcile dependent
transaction history before deleting accounting_taxes rows and remain idempotent.