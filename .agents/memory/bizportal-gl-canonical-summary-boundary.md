---
name: BizPortal GL canonical summary boundary
description: General Ledger totals, balances, and detail rows must share one canonical posted-status scope.
---

## Rule

General Ledger debit, credit, opening/closing balance, pagination metadata, and detail rows must be derived from the same canonical accounting scope. Voided and audit-only rows may remain visible with their status, but must not be included in canonical financial totals unless the UI labels the figure explicitly as audit-inclusive.

**Why:** A production audit showed a voided revenue line included in the credit total while the closing balance excluded it, creating a difference equal to the voided amount. The source view itself is row-unique, so this is a status-scope contract failure rather than a JOIN duplicate.

**How to apply:** Keep the BizPortal display faithful to the API response; if the response mixes scopes, fix the owning API/query contract rather than compensating in the browser. Preserve the voided row for audit traceability.