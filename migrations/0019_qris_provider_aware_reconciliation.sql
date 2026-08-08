-- QRIS provider-aware candidate/review layer.
-- Safe rollout: additive only; no DROP, DELETE, journal posting, or final
-- reconciliation. Existing rows remain valid and default to unknown.

ALTER TABLE bank_mutations
  ADD COLUMN IF NOT EXISTS source_classification TEXT NOT NULL DEFAULT 'unknown';

ALTER TABLE sport_payments
  ADD COLUMN IF NOT EXISTS provider_code TEXT NOT NULL DEFAULT 'unknown';

CREATE TABLE IF NOT EXISTS qris_business_calendar_holidays (
  id SERIAL PRIMARY KEY,
  company_id INTEGER,
  holiday_date DATE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, holiday_date)
);

CREATE TABLE IF NOT EXISTS qris_provider_settlement_rules (
  id SERIAL PRIMARY KEY,
  company_id INTEGER,
  provider_code TEXT NOT NULL,
  settlement_delay_business_days INTEGER NOT NULL DEFAULT 1,
  match_window_business_days INTEGER NOT NULL DEFAULT 1,
  max_effective_deduction_rate NUMERIC(7,6) NOT NULL DEFAULT 0.100000,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, provider_code)
);

ALTER TABLE qris_mutation_batch_candidates
  ADD COLUMN IF NOT EXISTS provider_code TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS mutation_source_classification TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT NOT NULL DEFAULT 'UNMATCHED',
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS observed_deduction NUMERIC(16,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS effective_deduction_rate NUMERIC(9,8),
  ADD COLUMN IF NOT EXISTS review_reason TEXT,
  ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_qris_candidates_status
  ON qris_mutation_batch_candidates(company_id, reconciliation_status, source_date);

CREATE INDEX IF NOT EXISTS idx_qris_candidates_provider
  ON qris_mutation_batch_candidates(provider_code, estimated_settlement_date);