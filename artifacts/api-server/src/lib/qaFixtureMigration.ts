/**
 * QA Fixture Migration
 * ====================
 * Adds `fixture_source` column to vendor_catalog_items.
 * This column is the marker for all QA-managed rows — fixture_source = 'qa'.
 * Idempotent (IF NOT EXISTS guards).
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function runQaFixtureMigration(): Promise<void> {
  // Add fixture_source column (nullable TEXT)
  await db.execute(sql`
    ALTER TABLE vendor_catalog_items
    ADD COLUMN IF NOT EXISTS fixture_source TEXT DEFAULT NULL
  `).catch(() => {});

  // Add index so DELETE/SELECT WHERE fixture_source='qa' is fast
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS vendor_catalog_fixture_source_idx
    ON vendor_catalog_items (fixture_source)
    WHERE fixture_source IS NOT NULL
  `).catch(() => {});

  console.log("[qaFixtureMigration] fixture_source column ready.");
}
