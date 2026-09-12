-- Phase 2E: attachment_filename on mkt_vendor_quotes
-- Idempotent — pakai IF NOT EXISTS
-- Additive only — tidak ada DROP atau ALTER existing column

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'mkt_vendor_quotes'
      AND column_name  = 'attachment_filename'
  ) THEN
    ALTER TABLE mkt_vendor_quotes ADD COLUMN attachment_filename TEXT;
  END IF;
END $$;
