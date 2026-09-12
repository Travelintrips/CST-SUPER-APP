-- Complete approval/quote columns for legacy Air Freight order tables.
-- Additive only; existing order values and ownership are untouched.

DO $$ BEGIN
  ALTER TABLE air_freight_orders
    ADD COLUMN IF NOT EXISTS admin_quote_attachment_url TEXT,
    ADD COLUMN IF NOT EXISTS quote_token TEXT,
    ADD COLUMN IF NOT EXISTS quote_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approved_vendor_id INTEGER;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;