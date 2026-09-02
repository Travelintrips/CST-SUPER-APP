import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";

/**
 * Additive repair for environments where the original Batch 3 migration was
 * already marked complete before allocation lineage was introduced.
 */
export async function runBankMutationAllocationLineageMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE payment_allocations
    ADD COLUMN IF NOT EXISTS source_allocation_id INTEGER
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS pa_source_allocation_active_unique
    ON payment_allocations(source_allocation_id)
    WHERE source_allocation_id IS NOT NULL AND is_active = TRUE
  `);
  logger.info("[bank-mutation-allocation-lineage] migration complete");
}