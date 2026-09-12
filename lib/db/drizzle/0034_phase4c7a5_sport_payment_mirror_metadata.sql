-- Phase 4C-7A.5: additive public Sport Center mirror metadata.
-- Development migration only for this controlled phase. Historical rows remain
-- untouched and all columns are deliberately nullable.
ALTER TABLE public.sport_payments
  ADD COLUMN IF NOT EXISTS provider_id TEXT,
  ADD COLUMN IF NOT EXISTS external_bank_account_id TEXT,
  ADD COLUMN IF NOT EXISTS source_schema TEXT,
  ADD COLUMN IF NOT EXISTS source_table TEXT;