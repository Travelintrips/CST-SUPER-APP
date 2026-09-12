import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Additive Marketplace negotiated/deal price schema.
 *
 * Vendor quote amounts remain the source-cost evidence. Deal amounts are
 * separate nullable columns populated only by the authorized negotiation flow.
 * This migration intentionally does not backfill existing rows.
 */
export async function runMktDealPriceMigration(): Promise<void> {
  await db.execute(sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'mkt_vendor_quotes'
      ) THEN
        ALTER TABLE mkt_vendor_quotes
          ADD COLUMN IF NOT EXISTS negotiated_by TEXT,
          ADD COLUMN IF NOT EXISTS negotiated_at TIMESTAMP,
          ADD COLUMN IF NOT EXISTS negotiated_notes TEXT;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'mkt_vendor_quote_lines'
      ) THEN
        ALTER TABLE mkt_vendor_quote_lines
          ADD COLUMN IF NOT EXISTS negotiated_unit_price NUMERIC(14,2),
          ADD COLUMN IF NOT EXISTS negotiated_subtotal NUMERIC(14,2);
      END IF;
    END $$;
  `);
  logger.info("[mktDealPriceMigration] additive schema applied; historical prices unchanged");
}