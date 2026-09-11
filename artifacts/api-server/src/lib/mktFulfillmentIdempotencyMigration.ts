import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Additive schema repair for canonical Marketplace fulfillment retries.
 * Kept independent from the older fulfillment migrations so an already
 * completed startup marker cannot skip these columns and indexes.
 */
export async function runMktFulfillmentIdempotencyMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE mkt_po_shipments
      ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS mkt_po_shipments_po_idempotency_key_uniq
      ON mkt_po_shipments (po_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;

    ALTER TABLE mkt_po_shipment_events
      ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS mkt_po_shipment_events_shipment_idempotency_key_uniq
      ON mkt_po_shipment_events (shipment_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;

    ALTER TABLE mkt_po_goods_receipts
      ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS mkt_po_goods_receipts_shipment_idempotency_key_uniq
      ON mkt_po_goods_receipts (shipment_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `);
  logger.info("Marketplace fulfillment idempotency migration: ok");
}