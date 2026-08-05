-- Fleet Ingestion Reliability — Zero Data Loss System
-- Migration 0011

SET search_path TO public;

-- ─── A. RAW LAYER ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gojek_uploaded_files (
  id              SERIAL PRIMARY KEY,
  company_id      INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  file_hash       TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  file_size_bytes INTEGER DEFAULT 0,
  mime_type       TEXT DEFAULT 'text/csv',
  status          TEXT NOT NULL DEFAULT 'pending',
  -- status: pending | ingesting | done | failed | replaced
  total_rows      INTEGER DEFAULT 0,
  success_rows    INTEGER DEFAULT 0,
  failed_rows     INTEGER DEFAULT 0,
  dlq_count       INTEGER DEFAULT 0,
  uploaded_by     TEXT,
  uploaded_by_email TEXT,
  replaced_by_file_id INTEGER,
  -- back-ref to fleet_reports for compat
  fleet_report_id INTEGER REFERENCES fleet_reports(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gojek_files_company_idx  ON gojek_uploaded_files(company_id);
CREATE INDEX IF NOT EXISTS gojek_files_hash_idx     ON gojek_uploaded_files(file_hash);
CREATE INDEX IF NOT EXISTS gojek_files_status_idx   ON gojek_uploaded_files(status);

CREATE TABLE IF NOT EXISTS gojek_raw_transactions (
  id              BIGSERIAL PRIMARY KEY,
  file_id         INTEGER NOT NULL REFERENCES gojek_uploaded_files(id) ON DELETE CASCADE,
  company_id      INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  row_number      INTEGER NOT NULL,
  raw_payload     JSONB NOT NULL,
  -- ingestion status per row
  ingestion_status TEXT NOT NULL DEFAULT 'pending',
  -- pending | transformed | failed
  fleet_transaction_id INTEGER REFERENCES fleet_transactions(id) ON DELETE SET NULL,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gojek_raw_file_idx       ON gojek_raw_transactions(file_id);
CREATE INDEX IF NOT EXISTS gojek_raw_company_idx    ON gojek_raw_transactions(company_id);
CREATE INDEX IF NOT EXISTS gojek_raw_status_idx     ON gojek_raw_transactions(ingestion_status);

-- ─── B. INGESTION CONTROL ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gojek_ingestion_queue (
  id              SERIAL PRIMARY KEY,
  file_id         INTEGER NOT NULL REFERENCES gojek_uploaded_files(id) ON DELETE CASCADE,
  company_id      INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'queued',
  -- queued | processing | done | failed
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gojek_queue_file_idx     ON gojek_ingestion_queue(file_id);
CREATE INDEX IF NOT EXISTS gojek_queue_status_idx   ON gojek_ingestion_queue(status);

CREATE TABLE IF NOT EXISTS gojek_ingestion_reports (
  id              SERIAL PRIMARY KEY,
  file_id         INTEGER NOT NULL REFERENCES gojek_uploaded_files(id) ON DELETE CASCADE,
  company_id      INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  total_rows      INTEGER DEFAULT 0,
  success_rows    INTEGER DEFAULT 0,
  failed_rows     INTEGER DEFAULT 0,
  dlq_count       INTEGER DEFAULT 0,
  ledger_entries_created INTEGER DEFAULT 0,
  summary_stats   JSONB,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gojek_ingest_report_file ON gojek_ingestion_reports(file_id);

-- ─── C. NORMALIZATION LAYER ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS transaction_type_mapping (
  id              SERIAL PRIMARY KEY,
  raw_type        TEXT NOT NULL,
  normalized_type TEXT NOT NULL,
  category        TEXT DEFAULT 'income',
  -- income | deduction | tax | adjustment
  is_credit       BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS txn_type_raw_unique ON transaction_type_mapping(raw_type);

-- Seed common Gojek transaction types
INSERT INTO transaction_type_mapping (raw_type, normalized_type, category, is_credit) VALUES
  ('goride',         'GoRide',         'income',     TRUE),
  ('gofood',         'GoFood',         'income',     TRUE),
  ('gocar',          'GoCar',          'income',     TRUE),
  ('gomart',         'GoMart',         'income',     TRUE),
  ('insentif',       'Incentive',      'income',     TRUE),
  ('incentive',      'Incentive',      'income',     TRUE),
  ('bonus',          'Incentive',      'income',     TRUE),
  ('komisi',         'Commission',     'deduction',  FALSE),
  ('commission',     'Commission',     'deduction',  FALSE),
  ('potongan',       'Deduction',      'deduction',  FALSE),
  ('deduction',      'Deduction',      'deduction',  FALSE),
  ('ppn',            'PPN',            'tax',        FALSE),
  ('pajak',          'PPN',            'tax',        FALSE),
  ('outstanding',    'Outstanding',    'adjustment', FALSE)
ON CONFLICT (raw_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS ledger_transaction_rules (
  id              SERIAL PRIMARY KEY,
  rule_name       TEXT NOT NULL UNIQUE,
  transaction_type TEXT NOT NULL,
  debit_account   TEXT NOT NULL,
  credit_account  TEXT NOT NULL,
  amount_field    TEXT NOT NULL DEFAULT 'grossRevenue',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO ledger_transaction_rules (rule_name, transaction_type, debit_account, credit_account, amount_field) VALUES
  ('fleet_gross_revenue',  'income',     'Accounts Receivable',     'Fleet Revenue',        'grossRevenue'),
  ('fleet_commission',     'deduction',  'Cost of Service - Fleet', 'Accounts Payable',     'commission'),
  ('fleet_incentive',      'income',     'Fleet Incentive Expense', 'Fleet Revenue',        'incentive'),
  ('fleet_ppn',            'tax',        'PPN Keluaran',            'Tax Payable',          'ppnAmount'),
  ('fleet_outstanding',    'adjustment', 'Fleet AR Outstanding',    'Accounts Receivable',  'outstandingBalance')
ON CONFLICT (rule_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS transaction_datetime_normalized (
  id              BIGSERIAL PRIMARY KEY,
  raw_transaction_id BIGINT REFERENCES gojek_raw_transactions(id) ON DELETE CASCADE,
  raw_datetime    TEXT,
  parsed_date     DATE,
  parsed_time     TIME,
  timezone        TEXT DEFAULT 'Asia/Jakarta',
  parse_success   BOOLEAN NOT NULL DEFAULT FALSE,
  parse_method    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS txn_dt_raw_idx ON transaction_datetime_normalized(raw_transaction_id);

-- ─── D. GOVERNANCE LAYER ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gojek_failed_rows (
  id              BIGSERIAL PRIMARY KEY,
  file_id         INTEGER NOT NULL REFERENCES gojek_uploaded_files(id) ON DELETE CASCADE,
  company_id      INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  row_number      INTEGER NOT NULL,
  raw_payload     JSONB,
  error_message   TEXT NOT NULL,
  error_code      TEXT DEFAULT 'TRANSFORM_ERROR',
  -- TRANSFORM_ERROR | VALIDATE_ERROR | DATE_PARSE_ERROR | DB_ERROR
  retry_count     INTEGER DEFAULT 0,
  resolved        BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at     TIMESTAMPTZ,
  resolved_by     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gojek_dlq_file_idx       ON gojek_failed_rows(file_id);
CREATE INDEX IF NOT EXISTS gojek_dlq_company_idx    ON gojek_failed_rows(company_id);
CREATE INDEX IF NOT EXISTS gojek_dlq_resolved_idx   ON gojek_failed_rows(resolved);

CREATE TABLE IF NOT EXISTS gojek_pipeline_audit_logs (
  id              BIGSERIAL PRIMARY KEY,
  file_id         INTEGER REFERENCES gojek_uploaded_files(id) ON DELETE CASCADE,
  company_id      INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  -- FILE_REGISTERED | INGESTION_STARTED | INGESTION_DONE | ROW_FAILED | ROW_SUCCESS
  -- REPLACE_TRIGGERED | DELETE_ALL_DATA | LEDGER_GENERATED
  event_data      JSONB,
  performed_by    TEXT,
  performed_by_email TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gojek_pal_file_idx       ON gojek_pipeline_audit_logs(file_id);
CREATE INDEX IF NOT EXISTS gojek_pal_event_idx      ON gojek_pipeline_audit_logs(event_type);
CREATE INDEX IF NOT EXISTS gojek_pal_created_idx    ON gojek_pipeline_audit_logs(created_at);

CREATE TABLE IF NOT EXISTS fleet_pipeline_health (
  id              SERIAL PRIMARY KEY,
  company_id      INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  check_time      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_files     INTEGER DEFAULT 0,
  total_raw_rows  BIGINT DEFAULT 0,
  total_transformed INTEGER DEFAULT 0,
  total_failed    INTEGER DEFAULT 0,
  dlq_unresolved  INTEGER DEFAULT 0,
  ingestion_rate_pct NUMERIC(5,2) DEFAULT 0,
  last_upload_at  TIMESTAMPTZ,
  last_upload_file TEXT,
  health_status   TEXT NOT NULL DEFAULT 'ok',
  -- ok | warn | critical
  alerts          JSONB
);
CREATE INDEX IF NOT EXISTS fleet_ph_company_idx     ON fleet_pipeline_health(company_id);
CREATE INDEX IF NOT EXISTS fleet_ph_time_idx        ON fleet_pipeline_health(check_time);

CREATE TABLE IF NOT EXISTS fleet_reconciliation_reports (
  id              SERIAL PRIMARY KEY,
  company_id      INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  file_id         INTEGER REFERENCES gojek_uploaded_files(id) ON DELETE SET NULL,
  period          TEXT,
  raw_row_count   INTEGER DEFAULT 0,
  transformed_count INTEGER DEFAULT 0,
  dlq_count       INTEGER DEFAULT 0,
  ledger_debit    NUMERIC(18,2) DEFAULT 0,
  ledger_credit   NUMERIC(18,2) DEFAULT 0,
  reconcile_status TEXT NOT NULL DEFAULT 'pending',
  -- pending | balanced | unbalanced | error
  discrepancies   JSONB,
  run_by          TEXT,
  run_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fleet_recon_company_idx  ON fleet_reconciliation_reports(company_id);
CREATE INDEX IF NOT EXISTS fleet_recon_file_idx     ON fleet_reconciliation_reports(file_id);

-- ─── E. LEDGER EVENTS (complement to fleet_ledger_entries) ────────────────────

CREATE TABLE IF NOT EXISTS ledger_events (
  id              BIGSERIAL PRIMARY KEY,
  company_id      INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  -- ENTRY_CREATED | ENTRY_VOIDED | SNAPSHOT_TAKEN | PERIOD_CLOSED | RECONCILE_RUN
  source_type     TEXT,
  -- fleet_file | accounting_entry | manual
  source_id       TEXT,
  payload         JSONB,
  performed_by    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ledger_events_company_idx ON ledger_events(company_id);
CREATE INDEX IF NOT EXISTS ledger_events_type_idx    ON ledger_events(event_type);
CREATE INDEX IF NOT EXISTS ledger_events_created_idx ON ledger_events(created_at);

-- ─── ADD STATUS TRACKING to fleet_reports (if not already there) ──────────────
ALTER TABLE fleet_reports
  ADD COLUMN IF NOT EXISTS raw_row_count   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dlq_count       INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gojek_file_id   INTEGER REFERENCES gojek_uploaded_files(id) ON DELETE SET NULL;
