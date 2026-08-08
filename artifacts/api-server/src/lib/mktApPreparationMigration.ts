import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Sprint 8 additive runtime migration. AP preparation owns only the handoff
 * state after a vendor invoice has already reached ready_for_ap. It does not
 * create payment, journal, accounting, or disbursement records.
 */
export async function runMktApPreparationMigration(): Promise<void> {
  await db.execute(sql`
    DO $$
    BEGIN
      CREATE TYPE "public"."mkt_ap_preparation_status" AS ENUM
        ('ap_preparation', 'finance_review', 'waiting_payment');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS mkt_ap_preparations (
      id SERIAL PRIMARY KEY,
      preparation_number TEXT NOT NULL UNIQUE,
      vendor_invoice_id INTEGER NOT NULL REFERENCES vendor_invoices(id) ON DELETE RESTRICT,
      mkt_purchase_order_id INTEGER NOT NULL REFERENCES mkt_purchase_orders(id) ON DELETE RESTRICT,
      mkt_goods_receipt_id INTEGER NOT NULL REFERENCES mkt_po_goods_receipts(id) ON DELETE RESTRICT,
      company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
      supplier_name TEXT NOT NULL,
      invoice_number_snapshot TEXT NOT NULL,
      vendor_invoice_ref_snapshot TEXT,
      currency_snapshot TEXT NOT NULL,
      total_amount_snapshot NUMERIC(14,2) NOT NULL,
      tax_amount_snapshot NUMERIC(14,2) NOT NULL,
      grand_total_snapshot NUMERIC(14,2) NOT NULL,
      status "mkt_ap_preparation_status" NOT NULL DEFAULT 'ap_preparation',
      notes TEXT,
      finance_reviewed_by TEXT,
      finance_reviewed_at TIMESTAMP,
      waiting_payment_at TIMESTAMP,
      created_by TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS mkt_ap_preparations_invoice_unique
      ON mkt_ap_preparations (vendor_invoice_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS mkt_ap_preparations_status_idx
      ON mkt_ap_preparations (status)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS mkt_ap_preparations_company_idx
      ON mkt_ap_preparations (company_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS mkt_ap_preparations_vendor_idx
      ON mkt_ap_preparations (supplier_id)
  `);
  logger.info("[mktApPreparationMigration] Sprint 8 AP preparation schema applied");
}