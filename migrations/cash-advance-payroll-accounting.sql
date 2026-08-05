-- Cash Advance & Payroll Accounting Automation
-- Idempotent DDL — safe to re-run. Apply to DEV first (SUPABASE_DATABASE_URL_DEV),
-- then to PROD (SUPABASE_DATABASE_URL) only after DEV smoke tests pass.
-- NOTE: pgBouncer (transaction mode) rejects multi-statement SQL in one call —
-- when applying programmatically, run each statement separately (e.g. `psql -f`).
--
-- Existing tables reused as-is (no rename): employees, payroll_runs, payroll_items.
-- Kasbon/talangan lives in cash_advances (party_name is free text; matched to
-- employees.first_name+last_name at runtime — there is no employee_id FK on
-- cash_advances by design, to avoid a data-migration of historical records).

-- ── 1. cash_advances: payroll deduction plan + posting tracking columns ─────
ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS repayment_method TEXT NOT NULL DEFAULT 'one_time';
ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS installment_count INTEGER;
ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS installment_amount NUMERIC(14,2);
ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS posting_status TEXT NOT NULL DEFAULT 'posted';
ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS posting_error TEXT;
ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS accounting_payment_id INTEGER;

-- ── 2. accounting_settings: payroll account mapping ──────────────────────────
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS salary_expense_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL;
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS allowance_expense_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL;
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS salary_payable_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL;
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS tax_payable_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL;
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS bpjs_payable_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL;

-- ── 3. payroll_runs: accounting + posting tracking columns ───────────────────
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS payment_entry_id INTEGER;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS posting_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS posting_error TEXT;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'bank';

-- ── 4. payroll_items: link back to the cash_advances row being deducted ──────
ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS cash_advance_id INTEGER;
CREATE INDEX IF NOT EXISTS payroll_items_cash_advance_idx ON payroll_items(cash_advance_id);
CREATE INDEX IF NOT EXISTS payroll_items_run_idx2 ON payroll_items(run_id);
CREATE INDEX IF NOT EXISTS payroll_items_employee_idx ON payroll_items(employee_id);
CREATE INDEX IF NOT EXISTS employees_company_idx ON employees(company_id);
