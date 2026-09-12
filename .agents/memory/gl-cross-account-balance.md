---
name: General Ledger cross-account balance
description: A single opening/closing balance is not meaningful when the GL displays multiple COA accounts.
---

The GL must expose opening and closing balances only for a selected account. For all accounts, show period debit/credit totals and keep running balances scoped to each COA row.

**Why:** Normal-balance normalization makes both sides of a balanced journal positive when summed across asset, liability, and revenue accounts, so the aggregate falsely grows by debit plus credit.

**How to apply:** Treat account-scoped balances as valid only when `account_id` is present; do not present a cross-account normalized sum as company saldo.