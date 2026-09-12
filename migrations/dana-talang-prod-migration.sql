-- ============================================================
-- MIGRATION: Dana Talang & Advance Management — DEV → PROD
-- Deskripsi : Semua kolom & tabel yang ditambahkan untuk fitur
--             Dana Talangan, Kasbon, dan Unified Advance Engine
--             yang sudah ada di DEV tapi belum ada di PROD.
-- Aturan    : Idempotent (IF NOT EXISTS / IF NOT EXISTS), aman
--             dijalankan berulang kali, tidak DROP, tidak hapus data.
-- Tanggal   : 2026-07-25
-- Jalankan  : psql "$SUPABASE_DATABASE_URL" -f dana-talang-prod-migration.sql
--   ATAU tiap statement satu per satu jika pakai pgBouncer transaction mode.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- BAGIAN 1: Kolom payroll-deduction & posting tracking
--           (dari: migrations/cash-advance-payroll-accounting.sql)
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS repayment_method       TEXT NOT NULL DEFAULT 'one_time';
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS installment_count      INTEGER;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS installment_amount     NUMERIC(14,2);
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS posting_status         TEXT NOT NULL DEFAULT 'posted';
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS posting_error          TEXT;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS accounting_payment_id  INTEGER;

-- payroll account mapping di accounting_settings
ALTER TABLE public.accounting_settings ADD COLUMN IF NOT EXISTS salary_expense_account_id   INTEGER REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.accounting_settings ADD COLUMN IF NOT EXISTS allowance_expense_account_id INTEGER REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.accounting_settings ADD COLUMN IF NOT EXISTS salary_payable_account_id   INTEGER REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.accounting_settings ADD COLUMN IF NOT EXISTS tax_payable_account_id      INTEGER REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.accounting_settings ADD COLUMN IF NOT EXISTS bpjs_payable_account_id     INTEGER REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;

-- payroll_runs: accounting + posting columns
ALTER TABLE public.payroll_runs ADD COLUMN IF NOT EXISTS payment_entry_id INTEGER;
ALTER TABLE public.payroll_runs ADD COLUMN IF NOT EXISTS posting_status   TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE public.payroll_runs ADD COLUMN IF NOT EXISTS posting_error    TEXT;
ALTER TABLE public.payroll_runs ADD COLUMN IF NOT EXISTS payment_method   TEXT NOT NULL DEFAULT 'bank';

-- payroll_items: link ke cash_advances yang dicicil
ALTER TABLE public.payroll_items ADD COLUMN IF NOT EXISTS cash_advance_id INTEGER;
CREATE INDEX IF NOT EXISTS payroll_items_cash_advance_idx ON public.payroll_items(cash_advance_id);
CREATE INDEX IF NOT EXISTS payroll_items_run_idx2          ON public.payroll_items(run_id);
CREATE INDEX IF NOT EXISTS payroll_items_employee_idx      ON public.payroll_items(employee_id);
CREATE INDEX IF NOT EXISTS employees_company_idx           ON public.employees(company_id);

-- ────────────────────────────────────────────────────────────
-- BAGIAN 2: Unified Advance Engine — kolom extended cash_advances
--           (dari: artifacts/api-server/src/routes/advances.ts → runAdvanceMigration)
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS advance_type        TEXT;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS lifecycle_status     TEXT;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS counterparty_type   TEXT;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS project_id          INTEGER;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS purpose             TEXT;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS approved_by         TEXT;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS approved_at         TIMESTAMP;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS disbursed_by        TEXT;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS currency            TEXT DEFAULT 'IDR';
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS exchange_rate        NUMERIC(12,6) DEFAULT 1;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS source_system       TEXT DEFAULT 'advance_management';
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS department_id       INTEGER;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS division_id         INTEGER;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS settled_at          TIMESTAMP;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS closed_at           TIMESTAMP;

-- ────────────────────────────────────────────────────────────
-- BAGIAN 3: Dana Talangan extended fields
--           (dari: advances.ts → runAdvanceMigration, dan cashAdvances.ts schema)
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS category_other           TEXT;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS funding_source_type      TEXT;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS source_company_id        INTEGER;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS source_bank_name         TEXT;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS source_party_name        TEXT;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS responsible_party_type   TEXT;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS responsible_company_id   INTEGER;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS responsible_bank_name    TEXT;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS responsible_vendor_id    INTEGER;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS responsible_employee_id  TEXT;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS responsible_party_name   TEXT;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS reference_number         TEXT;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS responsible_entry_id     INTEGER;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS funding_company_id       INTEGER;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS intercompany_reference   TEXT;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS funding_entry_id         INTEGER;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS intercompany_status      TEXT;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS intercompany_paid_amount NUMERIC(14,2) DEFAULT 0;

-- ────────────────────────────────────────────────────────────
-- BAGIAN 4: Kolom tambahan yang ada di DEV tapi tidak tercakup
--           di migration manapun (ditemukan dari introspeksi DEV DB)
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS accounting_entry_id INTEGER;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS employee_id          INTEGER;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS outstanding_amount   NUMERIC(14,2);
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS journal_id           INTEGER;

-- ────────────────────────────────────────────────────────────
-- BAGIAN 5: Tabel baru — advance_settlements
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.advance_settlements (
  id                SERIAL PRIMARY KEY,
  company_id        INTEGER NOT NULL,
  advance_id        INTEGER NOT NULL REFERENCES public.cash_advances(id) ON DELETE RESTRICT,
  settlement_number TEXT NOT NULL,
  date              DATE NOT NULL,
  bank_account_id   INTEGER,
  amount_received   NUMERIC(14,2) NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'IDR',
  exchange_rate     NUMERIC(12,6) NOT NULL DEFAULT 1,
  reference         TEXT,
  counterparty_name TEXT,
  status            TEXT NOT NULL DEFAULT 'posted',
  journal_id        INTEGER,
  notes             TEXT,
  created_by        TEXT,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS adv_stl_company_idx ON public.advance_settlements(company_id);
CREATE INDEX IF NOT EXISTS adv_stl_advance_idx ON public.advance_settlements(advance_id);
ALTER TABLE public.advance_settlements ADD COLUMN IF NOT EXISTS receipt_url TEXT;

-- ────────────────────────────────────────────────────────────
-- BAGIAN 6: Tabel baru — advance_allocation_lines
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.advance_allocation_lines (
  id                 SERIAL PRIMARY KEY,
  settlement_id      INTEGER NOT NULL REFERENCES public.advance_settlements(id) ON DELETE CASCADE,
  advance_id         INTEGER NOT NULL,
  allocation_type    TEXT NOT NULL,
  reference_doc_id   INTEGER,
  reference_doc_type TEXT,
  coa_id             INTEGER,
  amount             NUMERIC(14,2) NOT NULL,
  remarks            TEXT,
  journal_id         INTEGER,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS adv_alloc_stl_idx ON public.advance_allocation_lines(settlement_id);
CREATE INDEX IF NOT EXISTS adv_alloc_adv_idx ON public.advance_allocation_lines(advance_id);

-- ────────────────────────────────────────────────────────────
-- BAGIAN 7: Tabel baru — cash_advance_installment_schedules
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.cash_advance_installment_schedules (
  id                  SERIAL PRIMARY KEY,
  advance_id          INTEGER NOT NULL REFERENCES public.cash_advances(id) ON DELETE CASCADE,
  company_id          INTEGER NOT NULL,
  installment_number  INTEGER NOT NULL,
  due_date            DATE NOT NULL,
  amount              NUMERIC(14,2) NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  repayment_id        INTEGER REFERENCES public.cash_advance_repayments(id),
  paid_date           DATE,
  paid_amount         NUMERIC(14,2),
  notes               TEXT,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT cais_status_check CHECK (status IN ('pending','paid','overdue','waived'))
);
CREATE INDEX IF NOT EXISTS cais_advance_idx  ON public.cash_advance_installment_schedules(advance_id);
CREATE INDEX IF NOT EXISTS cais_company_idx  ON public.cash_advance_installment_schedules(company_id);
CREATE INDEX IF NOT EXISTS cais_due_date_idx ON public.cash_advance_installment_schedules(due_date);
CREATE UNIQUE INDEX IF NOT EXISTS cais_advance_num_idx ON public.cash_advance_installment_schedules(advance_id, installment_number);
-- kolom tambahan di installment_schedules yang ada di DEV
ALTER TABLE public.cash_advance_installment_schedules ADD COLUMN IF NOT EXISTS accounting_entry_id INTEGER;
ALTER TABLE public.cash_advance_installment_schedules ADD COLUMN IF NOT EXISTS payroll_item_id     INTEGER;

-- ────────────────────────────────────────────────────────────
-- BAGIAN 8: Kolom intercompany di cash_advance_repayments
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.cash_advance_repayments ADD COLUMN IF NOT EXISTS payer_company_id       INTEGER;
ALTER TABLE public.cash_advance_repayments ADD COLUMN IF NOT EXISTS payer_coa_account_id   INTEGER;
ALTER TABLE public.cash_advance_repayments ADD COLUMN IF NOT EXISTS receiver_company_id    INTEGER;
ALTER TABLE public.cash_advance_repayments ADD COLUMN IF NOT EXISTS receiver_coa_account_id INTEGER;
ALTER TABLE public.cash_advance_repayments ADD COLUMN IF NOT EXISTS payment_reference      TEXT;
ALTER TABLE public.cash_advance_repayments ADD COLUMN IF NOT EXISTS intercompany_reference TEXT;
ALTER TABLE public.cash_advance_repayments ADD COLUMN IF NOT EXISTS payer_journal_id       INTEGER;
ALTER TABLE public.cash_advance_repayments ADD COLUMN IF NOT EXISTS receiver_journal_id    INTEGER;
ALTER TABLE public.cash_advance_repayments ADD COLUMN IF NOT EXISTS idempotency_key        TEXT;
ALTER TABLE public.cash_advance_repayments ADD COLUMN IF NOT EXISTS posted_at              TIMESTAMP;
ALTER TABLE public.cash_advance_repayments ADD COLUMN IF NOT EXISTS created_by             TEXT;
ALTER TABLE public.cash_advance_repayments ADD COLUMN IF NOT EXISTS source_bank_name       TEXT;

CREATE INDEX IF NOT EXISTS car_payer_co_idx    ON public.cash_advance_repayments(payer_company_id);
CREATE INDEX IF NOT EXISTS car_receiver_co_idx ON public.cash_advance_repayments(receiver_company_id);
CREATE UNIQUE INDEX IF NOT EXISTS car_idempotency_idx ON public.cash_advance_repayments(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cash_advances_ic_ref_idx ON public.cash_advances(intercompany_reference) WHERE intercompany_reference IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- BAGIAN 9: Normalisasi data — type & lifecycle_status
--           (safe: hanya update baris dengan nilai non-canonical)
-- ────────────────────────────────────────────────────────────

-- Normalisasi type: 'employee_kasbon' dan sejenisnya → 'kasbon'
UPDATE public.cash_advances
SET type = 'kasbon'
WHERE type ILIKE '%kasbon%' AND type <> 'kasbon';

UPDATE public.cash_advances
SET type = 'talangan'
WHERE type NOT ILIKE '%kasbon%' AND type <> 'talangan';

-- Normalisasi advance_type untuk kasbon
UPDATE public.cash_advances
SET advance_type = 'EMPLOYEE'
WHERE type = 'kasbon'
  AND (
    advance_type IS NULL
    OR advance_type NOT IN ('EMPLOYEE','VENDOR','CUSTOMER','PROJECT','PURCHASE','TRAVEL','OPERATIONAL','OTHER')
  );

-- Normalisasi advance_type untuk talangan
UPDATE public.cash_advances
SET advance_type = CASE
      WHEN vendor_id IS NOT NULL THEN 'VENDOR'
      ELSE 'OPERATIONAL'
    END
WHERE type = 'talangan'
  AND (
    advance_type IS NULL
    OR advance_type NOT IN ('EMPLOYEE','VENDOR','CUSTOMER','PROJECT','PURCHASE','TRAVEL','OPERATIONAL','OTHER')
  );

-- Normalisasi lifecycle_status dari status lama
UPDATE public.cash_advances
SET lifecycle_status = CASE
      WHEN status = 'active'           THEN 'outstanding'
      WHEN status = 'partial'          THEN 'partially_settled'
      WHEN status = 'repaid'           THEN 'settled'
      WHEN status = 'accounted'        THEN 'settled'
      WHEN status IN ('void','rejected') THEN 'void'
      WHEN status = 'pending_approval' THEN 'pending_approval'
      ELSE 'outstanding'
    END
WHERE lifecycle_status IS NULL;

-- Tandai semua baris lama sebagai 'legacy'
UPDATE public.cash_advances
SET source_system = 'legacy'
WHERE source_system IS NULL
   OR (source_system = 'advance_management' AND created_at < NOW() - INTERVAL '1 minute');

-- ────────────────────────────────────────────────────────────
-- BAGIAN 10: Index tambahan untuk performa
-- ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS cash_advances_date_idx ON public.cash_advances(date);
CREATE INDEX IF NOT EXISTS cash_advances_company_idx ON public.cash_advances(company_id);
CREATE INDEX IF NOT EXISTS cash_advances_type_idx ON public.cash_advances(type);
CREATE INDEX IF NOT EXISTS cash_advances_status_idx ON public.cash_advances(status);

COMMIT;
