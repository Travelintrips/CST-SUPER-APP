import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Additive repair for environments that already completed the older
 * marketplace dual-write stages. The legacy compatibility row must share the
 * same logical request identity as the canonical RFQ.
 */
export async function runMarketplaceLegacyWriteIdempotencyMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE IF EXISTS portal_product_orders
      ADD COLUMN IF NOT EXISTS idempotency_key TEXT
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ppo_idempotency_key_uidx
      ON portal_product_orders (idempotency_key)
  `);
}