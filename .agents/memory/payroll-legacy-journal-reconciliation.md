---
name: Payroll legacy journal reconciliation
description: Legacy payroll runs may have a balanced accrual entry identified by period/ref while payroll linkage and payment evidence are missing.
---

Match legacy payroll accruals by company, period/run reference, posted status, and balanced gross amount before linking them to a payroll run.

**Why:** Older payroll data can store the accrual as `PAYROLL/YYYY-MM/R<run>` with no source ID, while a payment journal may not exist; creating a new accrual or payment would duplicate the ledger.

**How to apply:** Link the verified accrual, keep payment linkage null until actual payment evidence exists, mark the run explicitly legacy/manual, and fail closed on ambiguous candidates.