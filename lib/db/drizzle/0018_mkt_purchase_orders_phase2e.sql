-- Phase 2E: Snapshot columns + UNIQUE constraints on mkt_purchase_orders
-- Idempotent — semua statement pakai IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
-- Additive only — tidak ada DROP atau ALTER existing column

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'mkt_purchase_orders'
      AND column_name  = 'vendor_name_snapshot'
  ) THEN
    ALTER TABLE mkt_purchase_orders ADD COLUMN vendor_name_snapshot TEXT;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'mkt_purchase_orders'
      AND column_name  = 'vendor_address_snapshot'
  ) THEN
    ALTER TABLE mkt_purchase_orders ADD COLUMN vendor_address_snapshot TEXT;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'mkt_purchase_orders'
      AND column_name  = 'payment_terms_snapshot'
  ) THEN
    ALTER TABLE mkt_purchase_orders ADD COLUMN payment_terms_snapshot TEXT;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'mkt_purchase_orders'
      AND column_name  = 'incoterm_snapshot'
  ) THEN
    ALTER TABLE mkt_purchase_orders ADD COLUMN incoterm_snapshot TEXT;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'mkt_purchase_orders'
      AND column_name  = 'quotation_number_snapshot'
  ) THEN
    ALTER TABLE mkt_purchase_orders ADD COLUMN quotation_number_snapshot TEXT;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'mkt_purchase_orders'
      AND column_name  = 'quotation_date_snapshot'
  ) THEN
    ALTER TABLE mkt_purchase_orders ADD COLUMN quotation_date_snapshot DATE;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'mkt_purchase_orders'
      AND column_name  = 'currency_snapshot'
  ) THEN
    ALTER TABLE mkt_purchase_orders ADD COLUMN currency_snapshot TEXT;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'mkt_purchase_orders'
      AND column_name  = 'lead_time_days_snapshot'
  ) THEN
    ALTER TABLE mkt_purchase_orders ADD COLUMN lead_time_days_snapshot INTEGER;
  END IF;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS mkt_po_rfq_unique
  ON mkt_purchase_orders (rfq_id);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS mkt_po_quote_unique
  ON mkt_purchase_orders (quote_id);
