CREATE TABLE IF NOT EXISTS expense_lines (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL,
  qty NUMERIC(14,4) NOT NULL DEFAULT 1,
  unit TEXT,
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  coa_account_id INTEGER NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  coa_resolution_status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expense_lines_expense_line_no_uniq UNIQUE (expense_id, line_no),
  CONSTRAINT expense_lines_qty_positive CHECK (qty > 0),
  CONSTRAINT expense_lines_amounts_nonnegative CHECK (unit_price >= 0 AND subtotal >= 0 AND tax_amount >= 0 AND total >= 0)
);
CREATE INDEX IF NOT EXISTS expense_lines_company_idx ON expense_lines(company_id);
CREATE INDEX IF NOT EXISTS expense_lines_expense_idx ON expense_lines(expense_id);