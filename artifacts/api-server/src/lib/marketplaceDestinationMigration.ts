import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Development-only additive migration for the Marketplace RFQ destination
 * metadata. Production schema changes are promoted through the publish
 * migration process, not from a preview startup.
 */
export async function runMarketplaceDestinationMigration(): Promise<void> {
  if (process.env["NODE_ENV"] === "production" || process.env["REPLIT_DEPLOYMENT"]) {
    return;
  }

  await db.execute(sql`
    ALTER TABLE mkt_rfqs
      ADD COLUMN IF NOT EXISTS destination_place_id TEXT,
      ADD COLUMN IF NOT EXISTS destination_lat NUMERIC(10, 7),
      ADD COLUMN IF NOT EXISTS destination_lng NUMERIC(10, 7)
  `);
}