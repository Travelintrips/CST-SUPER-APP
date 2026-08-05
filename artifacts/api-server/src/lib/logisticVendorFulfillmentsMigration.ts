import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runLogisticVendorFulfillmentsMigration(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS logistic_vendor_fulfillments (
        id                    SERIAL PRIMARY KEY,
        order_id              INTEGER NOT NULL REFERENCES logistic_orders(id) ON DELETE CASCADE,
        order_item_id         INTEGER NOT NULL REFERENCES logistic_order_items(id) ON DELETE CASCADE,
        vendor_catalog_item_id INTEGER NOT NULL,
        vendor_id             INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        service_type          TEXT,
        status                TEXT NOT NULL DEFAULT 'pending',
        fulfillment_payload   JSONB,
        calculation_input     JSONB,
        template_snapshot     JSONB,
        price_snapshot        JSONB,
        admin_notes           TEXT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS lvf_order_item_uidx
        ON logistic_vendor_fulfillments(order_item_id)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS lvf_order_idx
        ON logistic_vendor_fulfillments(order_id)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS lvf_vendor_idx
        ON logistic_vendor_fulfillments(vendor_id)
    `);

    logger.info("Logistic vendor fulfillments migration: ok");
  } catch (err) {
    logger.warn({ err }, "Logistic vendor fulfillments migration warn");
  }
}
