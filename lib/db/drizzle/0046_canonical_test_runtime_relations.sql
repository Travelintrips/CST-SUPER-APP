-- Complete relations that are installed by the Sport Center runtime migration.
-- This is additive so databases that already recorded 0045 can converge too.

ALTER TABLE ppjk_orders
  DROP CONSTRAINT IF EXISTS ppjk_orders_company_id_fkey;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS company_bank_accounts (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'bank',
  bank_name TEXT,
  account_number TEXT,
  currency TEXT NOT NULL DEFAULT 'IDR',
  coa_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_by_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS company_bank_accounts_company_idx
  ON company_bank_accounts (company_id);
--> statement-breakpoint

CREATE SCHEMA IF NOT EXISTS sport_center;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS sport_center.payment_settlement_batches_id_seq;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sport_center.sport_payments (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_method TEXT NOT NULL DEFAULT 'cash',
  payment_type TEXT,
  payment_provider TEXT,
  company_id INTEGER,
  bank_account_id TEXT,
  expected_settlement_date DATE,
  settlement_rule_version TEXT,
  provider_name TEXT,
  provider_id TEXT,
  provider_order_id TEXT,
  confirmed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  uat_marker TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sport_center.accounting_journals (
  id SERIAL PRIMARY KEY,
  order_number TEXT NOT NULL,
  journal_type TEXT NOT NULL,
  debit_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  credit_revenue_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  credit_ppn_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  journal_date DATE NOT NULL,
  is_reversal BOOLEAN NOT NULL DEFAULT FALSE,
  company_id INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  gross_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  payment_id TEXT,
  settlement_id TEXT,
  settlement_reference TEXT,
  settlement_date DATE,
  settlement_batch_id TEXT,
  source_schema TEXT,
  source_table TEXT,
  source_id TEXT,
  correlation_id TEXT,
  created_by TEXT,
  posted_by TEXT,
  posted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_voided BOOLEAN NOT NULL DEFAULT FALSE,
  is_reversed BOOLEAN NOT NULL DEFAULT FALSE
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sport_center.payment_settlement_batches (
  id TEXT PRIMARY KEY DEFAULT nextval('sport_center.payment_settlement_batches_id_seq')::text,
  settlement_reference TEXT NOT NULL,
  company_id INTEGER NOT NULL,
  provider_code TEXT NOT NULL,
  provider_name TEXT,
  bank_account_id TEXT NOT NULL,
  settlement_date DATE NOT NULL,
  gross_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  mdr_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  provider_fee_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  fee_tax_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  tax_withheld_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  adjustment_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  bank_mutation_id INTEGER,
  canonical_bank_mutation_id INTEGER,
  settlement_journal_id INTEGER,
  calculated_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  reconciled_at TIMESTAMPTZ,
  calculated_by TEXT,
  posted_by TEXT,
  reconciled_by TEXT,
  settlement_rule_version TEXT,
  source TEXT,
  correlation_id TEXT,
  created_by TEXT,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sport_center.payment_settlement_items (
  id SERIAL PRIMARY KEY,
  settlement_id TEXT NOT NULL,
  payment_id INTEGER NOT NULL,
  payment_journal_id INTEGER,
  gross_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  mdr_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  provider_fee_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  fee_tax_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  tax_withheld_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  adjustment_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  item_status TEXT NOT NULL DEFAULT 'active',
  source_event_id TEXT,
  correlation_id TEXT,
  created_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sport_center_settlement_items_batch_idx
  ON sport_center.payment_settlement_items (settlement_id, item_status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sport_center_settlement_items_payment_idx
  ON sport_center.payment_settlement_items (payment_id, item_status);