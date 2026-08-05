-- Fix Fleet v7 Schema — Migration 0012
-- Drops tables created by 0011 (wrong schema) and recreates with correct v7 schema
-- matching what fleetIntelligence.ts v7 pipeline expects

SET search_path TO public;

-- ─── STEP 1: Drop all wrong-schema tables from 0011 (CASCADE removes orphan FK/indexes) ──
DROP TABLE IF EXISTS fleet_reconciliation_reports CASCADE;
DROP TABLE IF EXISTS fleet_pipeline_health CASCADE;
DROP TABLE IF EXISTS ledger_events CASCADE;
DROP TABLE IF EXISTS ledger_snapshots CASCADE;
DROP TABLE IF EXISTS ledger_entries CASCADE;
DROP TABLE IF EXISTS transaction_datetime_normalized CASCADE;
DROP TABLE IF EXISTS ledger_transaction_rules CASCADE;
DROP TABLE IF EXISTS transaction_type_mapping CASCADE;
DROP TABLE IF EXISTS gojek_ingestion_reports CASCADE;
DROP TABLE IF EXISTS gojek_uploaded_files CASCADE;

-- These two were already created correctly by runFleetIntelligenceMigration (v5/v6) 
-- but may have wrong schema from 0011 — drop and let the backend recreate on next start
-- Actually we should NOT drop gojek_failed_rows and gojek_ingestion_queue since they 
-- may have been created correctly by the v5/v6 migration. Just fix columns.

-- ─── STEP 2: Remove extra columns added by 0011 to fleet_reports ──────────────
ALTER TABLE fleet_reports DROP COLUMN IF EXISTS raw_row_count;
ALTER TABLE fleet_reports DROP COLUMN IF EXISTS dlq_count;
ALTER TABLE fleet_reports DROP COLUMN IF EXISTS gojek_file_id;

-- ─── STEP 3: Recreate v7 tables with CORRECT schema (matching fleetIntelligence.ts) ──

-- gojek_uploaded_files (v7 schema)
CREATE TABLE gojek_uploaded_files (
  id                SERIAL PRIMARY KEY,
  company_id        INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  report_id         INTEGER REFERENCES fleet_reports(id) ON DELETE SET NULL,
  file_hash         TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_size_bytes   BIGINT,
  mime_type         TEXT,
  upload_status     TEXT NOT NULL DEFAULT 'registered',
  uploaded_by       TEXT,
  uploaded_by_email TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX guf_company_idx ON gojek_uploaded_files(company_id);
CREATE UNIQUE INDEX guf_hash_company_uq ON gojek_uploaded_files(company_id, file_hash);

-- gojek_ingestion_reports (v7 schema)
CREATE TABLE gojek_ingestion_reports (
  id               SERIAL PRIMARY KEY,
  report_id        INTEGER REFERENCES fleet_reports(id) ON DELETE CASCADE,
  company_id       INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  total_raw_rows   INTEGER NOT NULL DEFAULT 0,
  inserted_raw     INTEGER NOT NULL DEFAULT 0,
  transformed_ok   INTEGER NOT NULL DEFAULT 0,
  failed_rows      INTEGER NOT NULL DEFAULT 0,
  dlq_rows         INTEGER NOT NULL DEFAULT 0,
  health_score     NUMERIC(5,2),
  health_grade     TEXT,
  duration_ms      INTEGER,
  pipeline_version TEXT NOT NULL DEFAULT 'v7',
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX gir_report_idx  ON gojek_ingestion_reports(report_id);
CREATE INDEX gir_company_idx ON gojek_ingestion_reports(company_id);

-- transaction_type_mapping (v7 schema)
CREATE TABLE transaction_type_mapping (
  id          SERIAL PRIMARY KEY,
  raw_type    TEXT NOT NULL,
  normalized  TEXT NOT NULL,
  ledger_side TEXT NOT NULL DEFAULT 'credit',
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ttm_raw_type_uq ON transaction_type_mapping(raw_type);

INSERT INTO transaction_type_mapping (raw_type, normalized, ledger_side, description) VALUES
  ('JASA MITRA', 'jasa_mitra', 'credit',  'Pendapatan jasa mitra GoRide/GoCar'),
  ('INSENTIF',   'insentif',   'credit',  'Insentif dari Gojek'),
  ('KOMISI',     'komisi',     'debit',   'Potongan komisi Gojek'),
  ('POTONGAN',   'potongan',   'debit',   'Potongan lain-lain'),
  ('BONUS',      'bonus',      'credit',  'Bonus dari Gojek'),
  ('REFUND',     'refund',     'credit',  'Refund ke mitra'),
  ('ADJUSTMEN',  'adjustmen',  'credit',  'Penyesuaian saldo'),
  ('PENARIKAN',  'penarikan',  'debit',   'Penarikan saldo ke rekening')
ON CONFLICT (raw_type) DO NOTHING;

-- ledger_transaction_rules (v7 schema)
CREATE TABLE ledger_transaction_rules (
  id          SERIAL PRIMARY KEY,
  rule_name   TEXT NOT NULL,
  match_field TEXT NOT NULL DEFAULT 'transaction_type',
  match_value TEXT NOT NULL,
  ledger_side TEXT NOT NULL,
  debit_account  TEXT,
  credit_account TEXT,
  priority    INTEGER NOT NULL DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ltr_rule_name_uq ON ledger_transaction_rules(rule_name);

-- transaction_datetime_normalized (v7 schema)
CREATE TABLE transaction_datetime_normalized (
  id                SERIAL PRIMARY KEY,
  raw_row_id        INTEGER REFERENCES gojek_raw_transactions(id) ON DELETE CASCADE,
  report_id         INTEGER REFERENCES fleet_reports(id) ON DELETE CASCADE,
  company_id        INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  raw_datetime      TEXT,
  parsed_date       DATE,
  parsed_time       TIME,
  timezone          TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  parse_method      TEXT,
  parse_confidence  NUMERIC(3,2) DEFAULT 1.0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX tdn_report_idx ON transaction_datetime_normalized(report_id);
CREATE INDEX tdn_date_idx   ON transaction_datetime_normalized(parsed_date);
CREATE UNIQUE INDEX tdn_raw_row_uq ON transaction_datetime_normalized(raw_row_id);

-- ledger_entries (v7 schema)
CREATE TABLE ledger_entries (
  id               SERIAL PRIMARY KEY,
  company_id       INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  report_id        INTEGER REFERENCES fleet_reports(id) ON DELETE SET NULL,
  raw_row_id       INTEGER REFERENCES gojek_raw_transactions(id) ON DELETE SET NULL,
  entry_date       DATE NOT NULL,
  account_code     TEXT NOT NULL,
  account_name     TEXT NOT NULL,
  side             TEXT NOT NULL,
  amount           NUMERIC(18,4) NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'IDR',
  description      TEXT,
  reference_id     TEXT,
  transaction_type TEXT,
  driver_id        INTEGER REFERENCES fleet_drivers(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX le_company_idx ON ledger_entries(company_id);
CREATE INDEX le_report_idx  ON ledger_entries(report_id);
CREATE INDEX le_date_idx    ON ledger_entries(entry_date);
CREATE INDEX le_account_idx ON ledger_entries(account_code);

-- ledger_snapshots (v7 schema — two-step for pgBouncer safety)
CREATE TABLE ledger_snapshots (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE ledger_snapshots ADD COLUMN snapshot_date DATE NOT NULL DEFAULT '2000-01-01';
ALTER TABLE ledger_snapshots ADD COLUMN account_code  TEXT NOT NULL DEFAULT '';
ALTER TABLE ledger_snapshots ADD COLUMN account_name  TEXT NOT NULL DEFAULT '';
ALTER TABLE ledger_snapshots ADD COLUMN balance       NUMERIC(18,4) NOT NULL DEFAULT 0;
ALTER TABLE ledger_snapshots ADD COLUMN debit_total   NUMERIC(18,4) NOT NULL DEFAULT 0;
ALTER TABLE ledger_snapshots ADD COLUMN credit_total  NUMERIC(18,4) NOT NULL DEFAULT 0;
ALTER TABLE ledger_snapshots ADD COLUMN entry_count   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ledger_snapshots ALTER COLUMN snapshot_date DROP DEFAULT;
ALTER TABLE ledger_snapshots ALTER COLUMN account_code  DROP DEFAULT;
ALTER TABLE ledger_snapshots ALTER COLUMN account_name  DROP DEFAULT;
CREATE INDEX ls_company_date_idx ON ledger_snapshots(company_id, snapshot_date);
CREATE UNIQUE INDEX ls_company_date_acct_uq ON ledger_snapshots(company_id, snapshot_date, account_code);

-- ledger_events (v7 schema)
CREATE TABLE ledger_events (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  report_id   INTEGER REFERENCES fleet_reports(id) ON DELETE SET NULL,
  event_type  TEXT NOT NULL,
  event_data  JSONB,
  actor       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX lev_company_idx ON ledger_events(company_id);
CREATE INDEX lev_report_idx  ON ledger_events(report_id);
CREATE INDEX lev_type_idx    ON ledger_events(event_type);

-- fleet_pipeline_health (v7 schema)
CREATE TABLE fleet_pipeline_health (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  report_id    INTEGER REFERENCES fleet_reports(id) ON DELETE SET NULL,
  health_score NUMERIC(5,2),
  grade        TEXT,
  total_raw    INTEGER DEFAULT 0,
  transformed  INTEGER DEFAULT 0,
  failed       INTEGER DEFAULT 0,
  dlq_rows     INTEGER DEFAULT 0,
  duration_ms  INTEGER,
  breakdown    JSONB,
  measured_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX fph_company_idx ON fleet_pipeline_health(company_id);
CREATE INDEX fph_report_idx  ON fleet_pipeline_health(report_id);
CREATE INDEX fph_score_idx   ON fleet_pipeline_health(health_score);

-- fleet_reconciliation_reports (v7 schema — two-step)
CREATE TABLE fleet_reconciliation_reports (
  id         SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  report_id  INTEGER REFERENCES fleet_reports(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE fleet_reconciliation_reports ADD COLUMN reconcile_date    DATE NOT NULL DEFAULT '2000-01-01';
ALTER TABLE fleet_reconciliation_reports ADD COLUMN raw_count         INTEGER DEFAULT 0;
ALTER TABLE fleet_reconciliation_reports ADD COLUMN ledger_count      INTEGER DEFAULT 0;
ALTER TABLE fleet_reconciliation_reports ADD COLUMN matched_count     INTEGER DEFAULT 0;
ALTER TABLE fleet_reconciliation_reports ADD COLUMN unmatched_raw     INTEGER DEFAULT 0;
ALTER TABLE fleet_reconciliation_reports ADD COLUMN unmatched_ledger  INTEGER DEFAULT 0;
ALTER TABLE fleet_reconciliation_reports ADD COLUMN total_raw_amount  NUMERIC(18,4) DEFAULT 0;
ALTER TABLE fleet_reconciliation_reports ADD COLUMN total_ledger_amount NUMERIC(18,4) DEFAULT 0;
ALTER TABLE fleet_reconciliation_reports ADD COLUMN variance          NUMERIC(18,4) DEFAULT 0;
ALTER TABLE fleet_reconciliation_reports ADD COLUMN status            TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE fleet_reconciliation_reports ADD COLUMN notes             TEXT;
ALTER TABLE fleet_reconciliation_reports ALTER COLUMN reconcile_date DROP DEFAULT;
CREATE INDEX frr_company_idx ON fleet_reconciliation_reports(company_id);
CREATE INDEX frr_report_idx  ON fleet_reconciliation_reports(report_id);
CREATE INDEX frr_date_idx    ON fleet_reconciliation_reports(reconcile_date);
