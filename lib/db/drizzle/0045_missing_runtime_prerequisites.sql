-- Additive TEST/runtime prerequisites.
-- These objects are canonical application schema, not test-only fixtures.

CREATE TABLE IF NOT EXISTS ppjk_orders (
  id SERIAL PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  company_id INTEGER,
  portal_order_id INTEGER,
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  customer_company TEXT,
  customer_npwp TEXT,
  trade_type TEXT NOT NULL DEFAULT 'import',
  commodity TEXT,
  hs_code TEXT,
  origin TEXT,
  destination TEXT,
  gross_weight NUMERIC(12,3),
  cbm NUMERIC(12,3),
  packing_type TEXT,
  koli INTEGER,
  port_of_entry TEXT,
  kantor_pabean TEXT,
  jenis_pelayanan TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  customs_status TEXT,
  nomor_aju TEXT,
  nomor_pib TEXT,
  nomor_peb TEXT,
  nomor_sppb TEXT,
  tanggal_aju TEXT,
  nilai_pabean NUMERIC(14,2),
  bea_masuk NUMERIC(14,2),
  ppn_impor NUMERIC(14,2),
  pph_impor NUMERIC(14,2),
  total_tagihan_pabean NUMERIC(14,2),
  service_fee NUMERIC(14,2),
  ppn_service_fee NUMERIC(14,2),
  total_service_fee NUMERIC(14,2),
  vendor_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  vendor_name TEXT,
  workflow_validated TEXT DEFAULT 'no',
  sla_deadline TIMESTAMPTZ,
  is_overdue TEXT DEFAULT 'no',
  status_entered_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_officer_name TEXT,
  assigned_officer_id TEXT,
  assigned_team TEXT,
  assigned_supervisor TEXT,
  assigned_at TIMESTAMPTZ,
  bmtp TEXT,
  bmad TEXT,
  storage_fee TEXT,
  handling_fee TEXT,
  thc TEXT,
  do_fee TEXT,
  forwarding_fee TEXT,
  trucking_fee TEXT,
  misc_fee TEXT,
  notes TEXT,
  admin_notes TEXT,
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS ppjk_company_idx ON ppjk_orders (company_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ppjk_status_idx ON ppjk_orders (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ppjk_trade_idx ON ppjk_orders (trade_type);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS ppjk_portal_order_id_uniq
  ON ppjk_orders (portal_order_id) WHERE portal_order_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE ppjk_orders
  DROP CONSTRAINT IF EXISTS ppjk_orders_company_id_fkey;
--> statement-breakpoint
ALTER TABLE ppjk_orders
  DROP CONSTRAINT IF EXISTS ppjk_orders_portal_order_id_fkey;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS ppjk_audit_logs (
  id SERIAL PRIMARY KEY,
  ppjk_order_id INTEGER NOT NULL REFERENCES ppjk_orders(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT NOT NULL,
  changed_by_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ppjk_audit_order_idx ON ppjk_audit_logs (ppjk_order_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS ppjk_status_logs (
  id SERIAL PRIMARY KEY,
  ppjk_order_id INTEGER NOT NULL REFERENCES ppjk_orders(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_by_id TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  ip_address TEXT,
  user_agent TEXT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ppjk_sl_order_idx ON ppjk_status_logs (ppjk_order_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ppjk_sl_changed_at_idx ON ppjk_status_logs (changed_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS ppjk_document_checklist (
  id SERIAL PRIMARY KEY,
  ppjk_order_id INTEGER NOT NULL REFERENCES ppjk_orders(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  doc_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  file_url TEXT,
  file_name TEXT,
  rejection_reason TEXT,
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  uploaded_by TEXT,
  uploaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ppjk_dc_order_idx ON ppjk_document_checklist (ppjk_order_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ppjk_dc_type_idx ON ppjk_document_checklist (ppjk_order_id, doc_type);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS ppjk_dc_order_type_uniq
  ON ppjk_document_checklist (ppjk_order_id, doc_type);
--> statement-breakpoint
ALTER TABLE ppjk_orders
  ADD CONSTRAINT ppjk_status_check CHECK (status IN (
    'draft','waiting_documents','document_review','document_completed',
    'quotation','waiting_customer','customer_approved',
    'preparing_pib','preparing_peb','submitted_ceisa','inspection',
    'red_lane','yellow_lane','green_lane','hold',
    'sppb','released','completed','cancelled'
  )) NOT VALID;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS recon_rules (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  direction TEXT CHECK (direction IN ('IN', 'OUT')),
  bank_account_id INTEGER,
  condition_type TEXT NOT NULL DEFAULT 'SIMPLE',
  condition_field TEXT NOT NULL,
  condition_operator TEXT NOT NULL,
  condition_value TEXT NOT NULL DEFAULT '',
  target_type TEXT NOT NULL,
  target_id INTEGER,
  target_coa_code TEXT,
  amount_tolerance NUMERIC(16,2),
  reference_amount NUMERIC(16,2),
  confidence_score INTEGER NOT NULL DEFAULT 100
    CHECK (confidence_score BETWEEN 0 AND 100),
  stop_processing BOOLEAN NOT NULL DEFAULT TRUE,
  match_count INTEGER NOT NULL DEFAULT 0,
  last_matched_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  conditions_json JSONB,
  logic TEXT NOT NULL DEFAULT 'AND',
  specificity INTEGER NOT NULL DEFAULT 1,
  ai_classification_rule_id INTEGER
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rr_company_idx ON recon_rules (company_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rr_priority_idx ON recon_rules (company_id, priority DESC, id ASC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rr_active_idx ON recon_rules (company_id, is_active);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS rr_ai_classification_rule_uniq
  ON recon_rules (ai_classification_rule_id)
  WHERE ai_classification_rule_id IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS expense_rules (
  id SERIAL PRIMARY KEY,
  company_id INTEGER,
  name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50,
  conditions JSONB NOT NULL DEFAULT '[]',
  action JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_expense_rules_company ON expense_rules (company_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_expense_rules_active ON expense_rules (is_active, priority);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_rules_name_company
  ON expense_rules (name, COALESCE(company_id::text, 'GLOBAL'));
--> statement-breakpoint

INSERT INTO expense_rules (company_id, name, priority, conditions, action, is_active)
SELECT NULL, seed.name, seed.priority, seed.conditions::jsonb, seed.action::jsonb, TRUE
FROM (VALUES
  ('Konsesi', 10, '[{"field":"category","operator":"eq","value":"concession"}]', '{"suggestedCategory":"concession","suggestedAccountType":"expense","suggestedAccountSubtype":"concession","confidence":88}'),
  ('Listrik dan Air — Listrik (PLN)', 20, '[{"field":"category","operator":"eq","value":"utility_electricity"}]', '{"suggestedCategory":"utility","suggestedAccountType":"expense","suggestedAccountSubtype":"utility","confidence":88}'),
  ('Listrik dan Air — Air (PDAM)', 21, '[{"field":"category","operator":"eq","value":"utility_water"}]', '{"suggestedCategory":"utility","suggestedAccountType":"expense","suggestedAccountSubtype":"utility","confidence":88}'),
  ('Ecommerce Settlement', 30, '[{"field":"category","operator":"eq","value":"ecommerce"}]', '{"suggestedCategory":"ecommerce_settlement","suggestedAccountType":"revenue","suggestedAccountSubtype":"ecommerce","confidence":85}'),
  ('Kas Besar — Internal Transfer', 5, '[{"field":"is_internal_transfer","operator":"eq","value":"true"}]', '{"suggestedCategory":"internal_transfer","suggestedAccountType":"asset","suggestedAccountSubtype":"cash_bank","isInternalTransfer":true,"confidence":90}'),
  ('Transfer Fee — Biaya Bank', 40, '[{"field":"is_bank_fee","operator":"eq","value":"true"}]', '{"suggestedCategory":"bank_fee","suggestedAccountType":"expense","suggestedAccountSubtype":"bank_charge","confidence":85}')
) AS seed(name, priority, conditions, action)
WHERE NOT EXISTS (
  SELECT 1 FROM expense_rules existing
  WHERE existing.company_id IS NULL AND existing.name = seed.name
);
--> statement-breakpoint

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'accounting_entry_source'::regtype
      AND enumlabel = 'sport_center_booking'
  ) THEN
    ALTER TYPE accounting_entry_source ADD VALUE 'sport_center_booking';
  END IF;
END
$migration$;
--> statement-breakpoint

DROP INDEX IF EXISTS idx_accounting_entries_source_source_id;
--> statement-breakpoint
DROP INDEX IF EXISTS idx_accounting_entries_co_src_srcid;
--> statement-breakpoint
DROP INDEX IF EXISTS accounting_entries_source_uniq;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS accounting_entries_company_source_source_id_uniq
  ON accounting_entries (company_id, source, source_id)
  WHERE source IS NOT NULL
    AND source_id IS NOT NULL
    AND source <> 'manual'::accounting_entry_source;
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