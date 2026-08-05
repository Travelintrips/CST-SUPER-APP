-- Migration 0018: Unique constraints on mkt_purchase_orders
-- Phase 2E — Race condition guard: satu RFQ max satu PO, satu quote max satu PO
--
-- Idempotent: gunakan DO $$ ... IF NOT EXISTS ... END $$ pattern.
-- Apply ke DEV dulu. Jangan apply ke PROD tanpa approval manual.
--
-- Runbook apply (DEV):
--   psql "$SUPABASE_MIGRATION_URL" -f migrations/0018_mkt_po_unique_constraints.sql
--
-- Rollback:
--   DROP INDEX IF EXISTS mkt_po_rfq_unique;
--   DROP INDEX IF EXISTS mkt_po_quote_unique;

DO $$
BEGIN
  -- UNIQUE(rfq_id): satu RFQ hanya boleh punya satu PO
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'mkt_purchase_orders'
      AND indexname  = 'mkt_po_rfq_unique'
  ) THEN
    CREATE UNIQUE INDEX mkt_po_rfq_unique
      ON public.mkt_purchase_orders (rfq_id);
    RAISE NOTICE 'Created index mkt_po_rfq_unique';
  ELSE
    RAISE NOTICE 'Index mkt_po_rfq_unique already exists — skipping';
  END IF;

  -- UNIQUE(quote_id): satu vendor quote hanya boleh punya satu PO
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'mkt_purchase_orders'
      AND indexname  = 'mkt_po_quote_unique'
  ) THEN
    CREATE UNIQUE INDEX mkt_po_quote_unique
      ON public.mkt_purchase_orders (quote_id);
    RAISE NOTICE 'Created index mkt_po_quote_unique';
  ELSE
    RAISE NOTICE 'Index mkt_po_quote_unique already exists — skipping';
  END IF;
END $$;
