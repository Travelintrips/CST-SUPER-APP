-- =============================================================================
-- TREASURY BATCH 4 — Cash Intelligence Schema
-- All tables: company-aware, FK, index, audit columns
-- Apply: psql "$SUPABASE_DATABASE_URL_DEV" -f migrations/treasury-batch4.sql
-- =============================================================================

-- ── 1. cash_position_snapshot ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cash_position_snapshot (
  id                     SERIAL PRIMARY KEY,
  company_id             INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  snapshot_date          DATE NOT NULL,
  bank_account_id        INTEGER REFERENCES company_bank_accounts(id) ON DELETE SET NULL,
  currency               TEXT NOT NULL DEFAULT 'IDR',
  current_cash           NUMERIC(18,2) NOT NULL DEFAULT 0,
  available_cash         NUMERIC(18,2) NOT NULL DEFAULT 0,
  restricted_cash        NUMERIC(18,2) NOT NULL DEFAULT 0,
  outstanding_receivable NUMERIC(18,2) NOT NULL DEFAULT 0,
  outstanding_payable    NUMERIC(18,2) NOT NULL DEFAULT 0,
  expected_incoming      NUMERIC(18,2) NOT NULL DEFAULT 0,
  expected_outgoing      NUMERIC(18,2) NOT NULL DEFAULT 0,
  net_position           NUMERIC(18,2) NOT NULL DEFAULT 0,
  snapshot_type          TEXT NOT NULL DEFAULT 'auto',
  created_by             TEXT,
  created_at             TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cash_position_snapshot_company_idx
  ON cash_position_snapshot(company_id);
CREATE INDEX IF NOT EXISTS cash_position_snapshot_date_idx
  ON cash_position_snapshot(snapshot_date);
CREATE INDEX IF NOT EXISTS cash_position_snapshot_company_date_idx
  ON cash_position_snapshot(company_id, snapshot_date);
CREATE INDEX IF NOT EXISTS cash_position_snapshot_account_idx
  ON cash_position_snapshot(bank_account_id);

-- ── 2. cash_forecast ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cash_forecast (
  id               SERIAL PRIMARY KEY,
  company_id       INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  forecast_date    DATE NOT NULL,
  horizon_days     INTEGER NOT NULL,
  horizon_date     DATE NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'IDR',
  expected_inflow  NUMERIC(18,2) NOT NULL DEFAULT 0,
  expected_outflow NUMERIC(18,2) NOT NULL DEFAULT 0,
  net_forecast     NUMERIC(18,2) NOT NULL DEFAULT 0,
  opening_balance  NUMERIC(18,2) NOT NULL DEFAULT 0,
  closing_balance  NUMERIC(18,2) NOT NULL DEFAULT 0,
  ar_component     NUMERIC(18,2) NOT NULL DEFAULT 0,
  ap_component     NUMERIC(18,2) NOT NULL DEFAULT 0,
  mutation_inflow  NUMERIC(18,2) NOT NULL DEFAULT 0,
  mutation_outflow NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cash_forecast_company_idx
  ON cash_forecast(company_id);
CREATE INDEX IF NOT EXISTS cash_forecast_date_idx
  ON cash_forecast(forecast_date);
CREATE INDEX IF NOT EXISTS cash_forecast_company_date_idx
  ON cash_forecast(company_id, forecast_date);
CREATE INDEX IF NOT EXISTS cash_forecast_horizon_idx
  ON cash_forecast(company_id, horizon_days);

-- ── 3. cash_variance ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cash_variance (
  id              SERIAL PRIMARY KEY,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_date     DATE NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'IDR',
  expected_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  actual_amount   NUMERIC(18,2) NOT NULL DEFAULT 0,
  variance_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  variance_pct    NUMERIC(10,4),
  variance_type   TEXT NOT NULL DEFAULT 'balance',
  forecast_id     INTEGER REFERENCES cash_forecast(id) ON DELETE SET NULL,
  snapshot_id     INTEGER REFERENCES cash_position_snapshot(id) ON DELETE SET NULL,
  traced_items    JSONB,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cash_variance_company_idx
  ON cash_variance(company_id);
CREATE INDEX IF NOT EXISTS cash_variance_date_idx
  ON cash_variance(period_date);
CREATE INDEX IF NOT EXISTS cash_variance_company_date_idx
  ON cash_variance(company_id, period_date);

-- ── 4. treasury_alert ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS treasury_alert (
  id              SERIAL PRIMARY KEY,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  alert_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  alert_type      TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'WARNING',
  title           TEXT NOT NULL,
  message         TEXT NOT NULL,
  value           NUMERIC(18,2),
  threshold       NUMERIC(18,2),
  currency        TEXT DEFAULT 'IDR',
  bank_account_id INTEGER REFERENCES company_bank_accounts(id) ON DELETE SET NULL,
  is_resolved     BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at     TIMESTAMP,
  resolved_by     TEXT,
  metadata        JSONB,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS treasury_alert_company_idx
  ON treasury_alert(company_id);
CREATE INDEX IF NOT EXISTS treasury_alert_date_idx
  ON treasury_alert(alert_date);
CREATE INDEX IF NOT EXISTS treasury_alert_type_idx
  ON treasury_alert(alert_type);
CREATE INDEX IF NOT EXISTS treasury_alert_company_unresolved_idx
  ON treasury_alert(company_id, is_resolved) WHERE is_resolved = FALSE;

-- ── 5. liquidity_metrics ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS liquidity_metrics (
  id                      SERIAL PRIMARY KEY,
  company_id              INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_date             DATE NOT NULL,
  quick_ratio             NUMERIC(10,4),
  current_ratio           NUMERIC(10,4),
  cash_coverage           NUMERIC(10,4),
  operating_cash_coverage NUMERIC(10,4),
  collection_efficiency   NUMERIC(10,4),
  payment_efficiency      NUMERIC(10,4),
  dso                     NUMERIC(10,2),
  dpo                     NUMERIC(10,2),
  current_assets          NUMERIC(18,2),
  current_liabilities     NUMERIC(18,2),
  cash_and_equivalents    NUMERIC(18,2),
  total_revenue_30d       NUMERIC(18,2),
  total_expenses_30d      NUMERIC(18,2),
  notes                   TEXT,
  created_at              TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS liquidity_metrics_company_idx
  ON liquidity_metrics(company_id);
CREATE INDEX IF NOT EXISTS liquidity_metrics_date_idx
  ON liquidity_metrics(period_date);
CREATE INDEX IF NOT EXISTS liquidity_metrics_company_date_idx
  ON liquidity_metrics(company_id, period_date);

-- =============================================================================
-- END treasury-batch4.sql
-- =============================================================================
