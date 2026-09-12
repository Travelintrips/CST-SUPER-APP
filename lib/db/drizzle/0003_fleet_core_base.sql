-- ─────────────────────────────────────────────────────────────────────────────
-- FLEET CORE BASE TABLES
-- 0011_fleet_ingestion_reliability and 0012_fix_fleet_v7_schema depend on the
-- tables normally installed by runFleetIntelligenceMigration at runtime.
-- Keep the fresh-database bootstrap aligned with that canonical definition.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet_partners (
  id              SERIAL PRIMARY KEY,
  company_id      INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  partner_type    TEXT NOT NULL DEFAULT 'gojek',
  contract_number TEXT,
  contact_name    TEXT,
  contact_phone   TEXT,
  contact_email   TEXT,
  address         TEXT,
  commission_rate NUMERIC(5,2) DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS fleet_partners_company_idx
  ON fleet_partners(company_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS fleet_reports (
  id               SERIAL PRIMARY KEY,
  company_id       INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  partner_id       INTEGER REFERENCES fleet_partners(id) ON DELETE SET NULL,
  filename         TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_hash        TEXT,
  version          INTEGER NOT NULL DEFAULT 1,
  report_type      TEXT NOT NULL DEFAULT 'gojek_driver',
  period_start     DATE,
  period_end       DATE,
  status           TEXT NOT NULL DEFAULT 'processing',
  row_count        INTEGER DEFAULT 0,
  processed_count  INTEGER DEFAULT 0,
  error_count      INTEGER DEFAULT 0,
  error_details    JSONB,
  uploaded_by      TEXT,
  uploaded_by_email TEXT,
  column_mapping   JSONB,
  summary_stats    JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS fleet_reports_company_idx
  ON fleet_reports(company_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS fleet_reports_status_idx
  ON fleet_reports(status);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS fleet_reports_period_idx
  ON fleet_reports(period_start, period_end);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS fleet_drivers (
  id                SERIAL PRIMARY KEY,
  company_id        INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  partner_id        INTEGER REFERENCES fleet_partners(id) ON DELETE SET NULL,
  driver_external_id TEXT,
  name              TEXT NOT NULL,
  phone             TEXT,
  email             TEXT,
  license_number    TEXT,
  vehicle_plate     TEXT,
  vehicle_type      TEXT,
  join_date         DATE,
  status            TEXT NOT NULL DEFAULT 'active',
  last_active_date  DATE,
  total_trips       INTEGER DEFAULT 0,
  total_revenue     NUMERIC(18,2) DEFAULT 0,
  avg_daily_trips   NUMERIC(8,2) DEFAULT 0,
  performance_tier  TEXT DEFAULT 'standard',
  notes             TEXT,
  raw_data          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS fleet_drivers_company_idx
  ON fleet_drivers(company_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS fleet_drivers_partner_idx
  ON fleet_drivers(partner_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS fleet_drivers_status_idx
  ON fleet_drivers(status);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS fleet_vehicles (
  id                SERIAL PRIMARY KEY,
  company_id        INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  partner_id        INTEGER REFERENCES fleet_partners(id) ON DELETE SET NULL,
  driver_id         INTEGER REFERENCES fleet_drivers(id) ON DELETE SET NULL,
  plate             TEXT NOT NULL,
  vehicle_type      TEXT NOT NULL DEFAULT 'motor',
  brand             TEXT,
  model             TEXT,
  year              INTEGER,
  color             TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  last_service_date DATE,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS fleet_vehicles_company_idx
  ON fleet_vehicles(company_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS fleet_vehicles_plate_idx
  ON fleet_vehicles(plate);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS fleet_transactions (
  id                  SERIAL PRIMARY KEY,
  company_id          INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  report_id           INTEGER REFERENCES fleet_reports(id) ON DELETE SET NULL,
  driver_id           INTEGER REFERENCES fleet_drivers(id) ON DELETE SET NULL,
  vehicle_id          INTEGER REFERENCES fleet_vehicles(id) ON DELETE SET NULL,
  driver_external_id  TEXT,
  driver_name         TEXT,
  vehicle_plate       TEXT,
  transaction_date    DATE NOT NULL,
  trip_count          INTEGER DEFAULT 0,
  gross_revenue       NUMERIC(18,2) DEFAULT 0,
  incentive           NUMERIC(18,2) DEFAULT 0,
  commission          NUMERIC(18,2) DEFAULT 0,
  deduction           NUMERIC(18,2) DEFAULT 0,
  net_revenue         NUMERIC(18,2) DEFAULT 0,
  outstanding_balance NUMERIC(18,2) DEFAULT 0,
  ppn_rate            NUMERIC(5,2) DEFAULT 0,
  ppn_amount          NUMERIC(18,2) DEFAULT 0,
  service_type        TEXT DEFAULT 'GoRide',
  raw_data            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS fleet_trx_company_idx
  ON fleet_transactions(company_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS fleet_trx_date_idx
  ON fleet_transactions(transaction_date);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS fleet_trx_driver_idx
  ON fleet_transactions(driver_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS fleet_trx_report_idx
  ON fleet_transactions(report_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS fleet_trx_plate_idx
  ON fleet_transactions(vehicle_plate);