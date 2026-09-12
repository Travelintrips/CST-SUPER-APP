-- Sprint 7 — Marketplace vendor invoice and 3-way match support.
-- Additive only: the generic purchase workflow remains compatible.

ALTER TYPE "public"."vi_status" ADD VALUE IF NOT EXISTS 'submitted';
ALTER TYPE "public"."vi_status" ADD VALUE IF NOT EXISTS 'ready_for_ap';

ALTER TABLE "vendor_invoices"
  ADD COLUMN IF NOT EXISTS "mkt_purchase_order_id" integer,
  ADD COLUMN IF NOT EXISTS "mkt_goods_receipt_id" integer,
  ADD COLUMN IF NOT EXISTS "currency" text NOT NULL DEFAULT 'IDR',
  ADD COLUMN IF NOT EXISTS "attachment_object_path" text,
  ADD COLUMN IF NOT EXISTS "attachment_file_name" text,
  ADD COLUMN IF NOT EXISTS "attachment_content_type" text,
  ADD COLUMN IF NOT EXISTS "attachment_size" integer;

ALTER TABLE "vendor_invoice_lines"
  ADD COLUMN IF NOT EXISTS "mkt_purchase_order_line_id" integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_invoices_mkt_po_id_fk'
  ) THEN
    ALTER TABLE "vendor_invoices"
      ADD CONSTRAINT "vendor_invoices_mkt_po_id_fk"
      FOREIGN KEY ("mkt_purchase_order_id") REFERENCES "public"."mkt_purchase_orders"("id")
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_invoices_mkt_gr_id_fk'
  ) THEN
    ALTER TABLE "vendor_invoices"
      ADD CONSTRAINT "vendor_invoices_mkt_gr_id_fk"
      FOREIGN KEY ("mkt_goods_receipt_id") REFERENCES "public"."mkt_po_goods_receipts"("id")
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_invoice_lines_mkt_po_line_id_fk'
  ) THEN
    ALTER TABLE "vendor_invoice_lines"
      ADD CONSTRAINT "vendor_invoice_lines_mkt_po_line_id_fk"
      FOREIGN KEY ("mkt_purchase_order_line_id") REFERENCES "public"."mkt_purchase_order_lines"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "vendor_invoices_mkt_po_idx"
  ON "vendor_invoices" ("mkt_purchase_order_id");
CREATE INDEX IF NOT EXISTS "vendor_invoices_mkt_gr_idx"
  ON "vendor_invoices" ("mkt_goods_receipt_id");
CREATE UNIQUE INDEX IF NOT EXISTS "vendor_invoices_supplier_ref_unique"
  ON "vendor_invoices" ("supplier_id", "vendor_invoice_ref")
  WHERE "supplier_id" IS NOT NULL AND "vendor_invoice_ref" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "vendor_invoice_lines_mkt_po_line_idx"
  ON "vendor_invoice_lines" ("mkt_purchase_order_line_id");