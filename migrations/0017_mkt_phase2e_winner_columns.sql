-- Migration 0017: Phase 2E — Winner selection columns + attachment_filename
-- Adds columns needed by vendorSelectionService.ts (getQuoteComparisonData, selectVendorAndCreatePo)
-- and vendor quote attachment download endpoint.
--
-- Idempotent: uses ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
-- Apply ke DEV dulu. Jangan apply ke PROD tanpa approval manual.
--
-- Runbook apply (DEV):
--   psql "$SUPABASE_MIGRATION_URL" -f migrations/0017_mkt_phase2e_winner_columns.sql
--
-- Rollback:
--   ALTER TABLE mkt_rfqs DROP COLUMN IF EXISTS winner_selected_at;
--   ALTER TABLE mkt_rfqs DROP COLUMN IF EXISTS winner_selected_by;
--   ALTER TABLE mkt_rfqs DROP COLUMN IF EXISTS winning_quote_id;
--   ALTER TABLE mkt_vendor_quotes DROP COLUMN IF EXISTS attachment_filename;

-- ── mkt_rfqs: winner selection result ────────────────────────────────────────
ALTER TABLE public.mkt_rfqs
  ADD COLUMN IF NOT EXISTS winner_selected_at  TIMESTAMP,
  ADD COLUMN IF NOT EXISTS winner_selected_by  TEXT,
  ADD COLUMN IF NOT EXISTS winning_quote_id    INTEGER
    REFERENCES public.mkt_vendor_quotes(id) ON DELETE SET NULL;

-- ── mkt_vendor_quotes: attachment filename ────────────────────────────────────
-- Phase 2E: stores the display filename of the vendor's quote attachment.
-- The signed download URL is stored in attachment_url (object storage key).
ALTER TABLE public.mkt_vendor_quotes
  ADD COLUMN IF NOT EXISTS attachment_filename TEXT;

-- ── mkt_vendor_quotes: Phase 2D fields (idempotent — boot migration also adds these) ──
-- These are also added by the API server boot migration; the SQL here ensures
-- DEV/PROD have them even if the API server hasn't run since Phase 2D was deployed.
ALTER TABLE public.mkt_vendor_quotes
  ADD COLUMN IF NOT EXISTS quotation_number   TEXT,
  ADD COLUMN IF NOT EXISTS quotation_date     DATE,
  ADD COLUMN IF NOT EXISTS payment_terms      TEXT,
  ADD COLUMN IF NOT EXISTS incoterm           TEXT,
  ADD COLUMN IF NOT EXISTS delivery_location  TEXT;

-- ── Indexes for new FK ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'mkt_rfqs'
      AND indexname  = 'mkt_rfqs_winning_quote_idx'
  ) THEN
    CREATE INDEX mkt_rfqs_winning_quote_idx ON public.mkt_rfqs (winning_quote_id);
    RAISE NOTICE 'Created index mkt_rfqs_winning_quote_idx';
  ELSE
    RAISE NOTICE 'Index mkt_rfqs_winning_quote_idx already exists — skipping';
  END IF;
END $$;
