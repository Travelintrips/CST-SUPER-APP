---
name: Expense Fase 10-13
description: Reminder worker, dashboard monitoring, expense templates, budget & multi-currency — patterns and gotchas
---

## Routes mounted
- `GET/POST /api/expense-dashboard` — aggregate summary
- `GET /api/expense-dashboard/reminders` + `POST /reminders/:id/dismiss`
- `GET /api/expense-dashboard/audit-log` + `POST`
- `GET /api/expense-dashboard/spt-export` — CSV download
- `GET /api/expense-templates` (active only), `/all`, `POST`, `PUT/:id`, `DELETE/:id`, `POST /seed`
- `GET /api/expense-config/currencies`, `PUT /currencies/:code`
- `GET/POST /api/expense-config/budgets`, `PUT/:id`, `DELETE/:id`, `GET /budgets/check`

## Frontend pages added
- `artifacts/bizportal/src/pages/expense/dashboard.tsx`
- `artifacts/bizportal/src/pages/expense/templates.tsx`
- `artifacts/bizportal/src/pages/expense/budget.tsx`
- Routes registered in `artifacts/bizportal/src/routes.tsx`
- Nav cards added in `artifacts/bizportal/src/pages/expense/index.tsx`

## Worker
- `startExpenseReminderWorker()` in `lib/expenseReminderWorker.ts`
- Registered in `api-server/src/index.ts` after `startRecurringExpenseWorker()`
- Scans: cash_advances, vendor_installments, bank_loans, expense_approval_requests
- Runs every 6h with 5min initial delay

## Tables created inline
- `expense_reminders` — UNIQUE(ref_type, ref_id, DATE_TRUNC('day', created_at)) for idempotency
- `expense_audit_log` — ref_type/ref_id indexed
- `expense_templates` — preset for category/account/tax/pm
- `currency_rates` — 10 currencies seeded (IDR base)
- `expense_budgets` — UNIQUE(company_id, year, month, category_id, department, project)
- ALTER TABLE expenses ADD COLUMN: currency_code, original_amount, exchange_rate, department, project

## Critical gotchas
1. **No `apiRequest` in bizportal pages** — use inline `apiFetch(url, opts?)` pattern (same as bank-loans.tsx)
2. **`useListChartOfAccounts` does NOT exist** in @workspace/api-client-react — use `apiFetch("/api/accounting/accounts")` directly
3. **`useListTaxes` and `useListExpenseCategories` DO exist** in api-client-react
4. **COA endpoint** is `/api/accounting/accounts` (not /coa)
