-- ─────────────────────────────────────────────────────────────────────────────
-- FINANCIAL CORE BASE TABLES
-- These tables are prerequisites for 0010_financial_core_stabilization.
-- Keep this migration additive and idempotent for fresh isolated databases and
-- existing environments whose older runtime migrations already created them.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS financial_periods (
  id               SERIAL PRIMARY KEY,
  company_id       INTEGER NOT NULL,
  month            INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year             INTEGER NOT NULL,
  is_closed        BOOLEAN NOT NULL DEFAULT FALSE,
  override_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  closed_at        TIMESTAMP,
  closed_by        TEXT,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT financial_periods_company_month_year_uniq
    UNIQUE (company_id, month, year)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS financial_periods_company_idx
  ON financial_periods (company_id, year, month);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS ledger_snapshots (
  id               SERIAL PRIMARY KEY,
  company_id       INTEGER NOT NULL,
  period           TEXT NOT NULL DEFAULT '',
  account_id       INTEGER,
  account_code     TEXT NOT NULL DEFAULT '',
  account_name     TEXT NOT NULL DEFAULT '',
  account_type     TEXT,
  opening_balance  NUMERIC(14,2) NOT NULL DEFAULT 0,
  period_debit     NUMERIC(14,2) NOT NULL DEFAULT 0,
  period_credit    NUMERIC(14,2) NOT NULL DEFAULT 0,
  closing_balance  NUMERIC(14,2) NOT NULL DEFAULT 0,
  entry_count      INTEGER NOT NULL DEFAULT 0,
  snapshot_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  closing_id       INTEGER,
  snapshot_hash    TEXT,
  previous_snapshot_hash TEXT,
  CONSTRAINT ledger_snapshots_company_period_account_uniq
    UNIQUE (company_id, period, account_id)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS ledger_snapshots_company_period_idx
  ON ledger_snapshots (company_id, period);