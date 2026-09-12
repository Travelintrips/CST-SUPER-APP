import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Additive migration — vendor_profiles missing fields.
 *
 * Adds only the columns listed below. Does NOT touch existing columns.
 * Each ALTER is a separate execute() call (pgBouncer transaction-mode restriction).
 * Every statement is wrapped in DO $$ BEGIN … END $$ for idempotency.
 *
 * Column list mirrors lib/db/src/schema/onboarding.ts vendorProfilesTable.
 * Safe to call multiple times.
 */

const COLUMNS: Array<[string, string]> = [
  ["pic_name",            "TEXT"],
  ["pic_position",        "TEXT"],
  ["phone",               "TEXT"],
  ["whatsapp",            "TEXT"],
  ["email",               "TEXT"],
  ["province",            "TEXT"],
  ["city",                "TEXT"],
  ["district",            "TEXT"],
  ["postal_code",         "TEXT"],
  ["full_address",        "TEXT"],
  ["bank_name",           "TEXT"],
  ["bank_account_name",   "TEXT"],
  ["bank_account_number", "TEXT"],
  ["company_logo",        "TEXT"],
  ["company_description", "TEXT"],
  ["business_type",       "TEXT"],
  // approval_date is stored as approved_at in the Drizzle schema (approvedAt)
  // Also add approval_date as an alias column for external compatibility
  ["approved_at",         "TIMESTAMPTZ"],
  ["approval_date",       "TIMESTAMPTZ"],
  // Bridge fields (also covered in index.ts boot migration for extra safety)
  ["verification_status", "TEXT NOT NULL DEFAULT 'unverified'"],
  ["supplier_id",         "INTEGER"],
  ["catalog_submission_link_id", "INTEGER"],
];

async function addColumnIfMissing(col: string, colDef: string): Promise<void> {
  await db.execute(
    sql.raw(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'vendor_profiles'
        ) THEN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name   = 'vendor_profiles'
              AND column_name  = '${col}'
          ) THEN
            ALTER TABLE vendor_profiles ADD COLUMN ${col} ${colDef};
          END IF;
        END IF;
      END $$;
    `)
  );
}

export async function runVendorProfileFieldsMigration(): Promise<void> {
  let added = 0;
  for (const [col, colDef] of COLUMNS) {
    await addColumnIfMissing(col, colDef).catch((e: unknown) =>
      logger.warn({ err: e }, `vendorProfileFieldsMigration: ADD COLUMN ${col} failed (non-fatal)`)
    );
    added++;
  }
  logger.info({ columnsProcessed: added }, "vendorProfileFieldsMigration: done");
}
