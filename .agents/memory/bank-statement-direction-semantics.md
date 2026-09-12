---
name: Bank statement direction semantics
description: The direction contract for bank statement imports and reconciliation.
---

Bank statement columns are interpreted from the bank-account perspective: Debit/Keluar means money leaving the account (`OUT`), while Credit/Masuk means money entering it (`IN`). Do not reuse accounting-ledger debit/credit wording for this import boundary.

**Why:** One import path previously applied the accounting convention in reverse, causing vendor payments to be stored as incoming transactions and sending matching toward inbound/Sport Center sources.

**How to apply:** Use one shared direction helper for Sheet, CSV, Excel, and any future bank import path. Protect posted/approved historical rows from automatic correction; repair legacy misclassified rows through an audited, guarded flow.