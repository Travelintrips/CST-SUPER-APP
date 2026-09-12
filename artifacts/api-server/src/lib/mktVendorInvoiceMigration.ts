import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Sprint 7 additive schema bridge. Kept as a runtime migration because the API
 * is deployed independently from the Drizzle package and must converge the
 * database it actually uses before the new route is reachable.
 */
export async function runMktVendorInvoiceMigration(): Promise<void> {
  await db.execute(sql`ALTER TYPE "public"."vi_status" ADD VALUE IF NOT EXISTS 'submitted'`);
  await db.execute(sql`ALTER TYPE "public"."vi_status" ADD VALUE IF NOT EXISTS 'ready_for_ap'`);
  await db.execute(sql`
    ALTER TABLE vendor_invoices
      ADD COLUMN IF NOT EXISTS mkt_purchase_order_id INTEGER,
      ADD COLUMN IF NOT EXISTS mkt_goods_receipt_id INTEGER,
      ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'IDR',
      ADD COLUMN IF NOT EXISTS attachment_object_path TEXT,
      ADD COLUMN IF NOT EXISTS attachment_file_name TEXT,
      ADD COLUMN IF NOT EXISTS attachment_content_type TEXT,
      ADD COLUMN IF NOT EXISTS attachment_size INTEGER
  `);
  await db.execute(sql`ALTER TABLE vendor_invoice_lines ADD COLUMN IF NOT EXISTS mkt_purchase_order_line_id INTEGER`);
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendor_invoices_mkt_po_id_fk') THEN
        ALTER TABLE vendor_invoices ADD CONSTRAINT vendor_invoices_mkt_po_id_fk
          FOREIGN KEY (mkt_purchase_order_id) REFERENCES mkt_purchase_orders(id) ON DELETE SET NULL;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendor_invoices_mkt_gr_id_fk') THEN
        ALTER TABLE vendor_invoices ADD CONSTRAINT vendor_invoices_mkt_gr_id_fk
          FOREIGN KEY (mkt_goods_receipt_id) REFERENCES mkt_po_goods_receipts(id) ON DELETE SET NULL;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendor_invoice_lines_mkt_po_line_id_fk') THEN
        ALTER TABLE vendor_invoice_lines ADD CONSTRAINT vendor_invoice_lines_mkt_po_line_id_fk
          FOREIGN KEY (mkt_purchase_order_line_id) REFERENCES mkt_purchase_order_lines(id) ON DELETE SET NULL;
      END IF;
    END $$
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vendor_invoices_mkt_po_idx ON vendor_invoices (mkt_purchase_order_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vendor_invoices_mkt_gr_idx ON vendor_invoices (mkt_goods_receipt_id)`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS vendor_invoices_supplier_ref_unique
      ON vendor_invoices (supplier_id, vendor_invoice_ref)
      WHERE supplier_id IS NOT NULL AND vendor_invoice_ref IS NOT NULL
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vendor_invoice_lines_mkt_po_line_idx ON vendor_invoice_lines (mkt_purchase_order_line_id)`);
  logger.info("[mktVendorInvoiceMigration] Sprint 7 schema bridge applied");
}