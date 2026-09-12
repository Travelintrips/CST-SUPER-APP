-- Additive forward migration for environments where 0001 was already applied.
-- Keep the equivalent idempotent statements in 0001 for fresh database bootstrap.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'freight_service_category'
      AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE public.freight_service_category AS ENUM (
      'FF_UDARA',
      'FF_LAUT',
      'PPJK',
      'TRUCKING',
      'MULTIMODAL',
      'GENERAL_FORWARDING'
    );
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE public.freight_shipments
  ADD COLUMN IF NOT EXISTS service_category public.freight_service_category;
--> statement-breakpoint
ALTER TABLE public.freight_shipments
  ADD COLUMN IF NOT EXISTS source_module text;
--> statement-breakpoint
ALTER TABLE public.freight_shipments
  ADD COLUMN IF NOT EXISTS source_order_id integer;
--> statement-breakpoint
ALTER TABLE public.freight_shipments
  ADD COLUMN IF NOT EXISTS freight_cost numeric(14, 2) DEFAULT '0';
--> statement-breakpoint
ALTER TABLE public.freight_shipments
  ADD COLUMN IF NOT EXISTS estimated_revenue numeric(14, 2);
--> statement-breakpoint
ALTER TABLE public.freight_shipments
  ADD COLUMN IF NOT EXISTS estimated_cost numeric(14, 2);
--> statement-breakpoint
ALTER TABLE public.freight_shipments
  ADD COLUMN IF NOT EXISTS actual_revenue numeric(14, 2);
--> statement-breakpoint
ALTER TABLE public.freight_shipments
  ADD COLUMN IF NOT EXISTS invoice_status text NOT NULL DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE public.freight_shipments
  ADD COLUMN IF NOT EXISTS vendor_bill_status text NOT NULL DEFAULT 'none';
