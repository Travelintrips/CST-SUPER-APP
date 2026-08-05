import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runProductFirstFlowMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE logistic_orders
      ADD COLUMN IF NOT EXISTS product_rfq_id                  INTEGER,
      ADD COLUMN IF NOT EXISTS product_vendor_id               INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS product_vendor_confirmed_at     TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS product_ready_date              TEXT,
      ADD COLUMN IF NOT EXISTS product_pickup_location         TEXT,
      ADD COLUMN IF NOT EXISTS product_qty_confirmed           NUMERIC(12,3),
      ADD COLUMN IF NOT EXISTS shipment_rfq_id                 INTEGER,
      ADD COLUMN IF NOT EXISTS shipment_mode                   TEXT,
      ADD COLUMN IF NOT EXISTS shipment_mode_selected_at       TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS customer_product_approval_token TEXT UNIQUE,
      ADD COLUMN IF NOT EXISTS customer_product_approved_at    TIMESTAMPTZ;
  `);

  await db.execute(sql`
    ALTER TABLE logistic_order_rfqs
      ADD COLUMN IF NOT EXISTS rfq_type TEXT DEFAULT 'shipment',
      ADD COLUMN IF NOT EXISTS phase    TEXT DEFAULT 'shipment_phase';
  `);

  await db.execute(sql`
    ALTER TABLE rfq_vendor_links
      ADD COLUMN IF NOT EXISTS rfq_type       TEXT,
      ADD COLUMN IF NOT EXISTS pickup_address TEXT,
      ADD COLUMN IF NOT EXISTS ready_date     TEXT,
      ADD COLUMN IF NOT EXISTS qty_confirmed  NUMERIC(12,3),
      ADD COLUMN IF NOT EXISTS qty_unit       TEXT;
  `);

  logger.info("Product-first flow migration: ok");
}
