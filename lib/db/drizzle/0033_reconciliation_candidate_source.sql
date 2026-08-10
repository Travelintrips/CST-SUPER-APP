-- Phase 4C-1: source-aware reconciliation candidate persistence.
-- Additive only: historical rows remain NULL and no existing identity is changed.
ALTER TABLE public.bank_reconciliation_matches
  ADD COLUMN IF NOT EXISTS candidate_source TEXT;