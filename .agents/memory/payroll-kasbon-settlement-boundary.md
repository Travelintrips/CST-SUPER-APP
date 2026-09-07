---
name: Payroll kasbon settlement boundary
description: Safe separation between payroll deduction settlement and unresolved net-salary payment evidence.
---

Kasbon deductions may be posted as a separate payable-to-employee-receivable settlement only when the exact repayment cohort, amount, company-scoped postable COAs, and open posting period are proven. The remaining salary payable must stay open until a bank/payment record is deterministically linked to the payroll run.

**Why:** Legacy payroll data can have a correct accrual and exact deduction total while bank descriptions contain several employee-name or “gaji” candidates with different totals; similar amounts are not proof of the payroll payment.

**How to apply:** Use one atomic, rerunnable settlement identity for the deduction cohort and fail closed on partial links, wrong COAs, locked periods, or duplicate identities. Treat name/description matches and unrelated aggregate bank totals as review candidates only.