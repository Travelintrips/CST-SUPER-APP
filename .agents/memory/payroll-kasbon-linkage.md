---
name: Payroll kasbon linkage
description: Payroll deductions must retain a source cash-advance identity before settlement or accounting posting.
---

A payroll item with a kasbon deduction but no source cash-advance ID is not a settled kasbon: it is legacy/manual evidence that needs controlled reconciliation before production repair. Payroll payment alone must not reduce the employee receivable.

**Why:** Production contained deduction-only payroll rows; without the source ID, approval cannot safely update the matching advance or create a repayment ledger row.

**How to apply:** Require employee/source-advance linkage at calculation and approval, validate the deduction against the advance balance, and treat existing unlinked rows as manual-repair candidates rather than auto-settling by name or amount.