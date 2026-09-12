---
  name: Kasbon settle-to-expense flow
  description: Third closure path for cash advances (kasbon/talangan) alongside repay and void — for money actually spent on company purchases.
  ---

  Kasbon (cash advance) now has three distinct closure mechanisms in `artifacts/api-server/src/routes/cashAdvances.ts`:
  - `/repay` — cash physically returned to company (DR Kas/Bank, CR Piutang)
  - `/void` — money never left (reversal), only allowed if paidAmount === 0
  - `/settle` (new) — money was spent on a legitimate company purpose (e.g. ATK) and proven via receipt; reclasses to expense (DR Beban, CR Piutang Karyawan), no cash movement. Final status `accounted` (distinct from `repaid`).

  **Why:** Before this, only repay/void existed, which didn't model the common case of an employee spending a cash advance and proving it with a receipt — forcing incorrect journal entries (fake cash return) to close it out.

  **How to apply:** When building similar "advance/settle" flows (e.g. talangan, PO down payments), keep this three-way split — don't conflate "proof of spend" with "cash returned". Settlement should require receipt_url already uploaded before allowing the reclass, and should increment paidAmount just like repayment so void guards still work correctly.
  