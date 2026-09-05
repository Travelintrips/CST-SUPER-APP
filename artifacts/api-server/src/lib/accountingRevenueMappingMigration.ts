import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Revenue mapping is intentionally additive and runtime-managed because the
 * API also runs against existing Supabase environments that do not replay the
 * Drizzle migration history.
 */
export async function runAccountingRevenueMappingMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS accounting_revenue_mappings (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      module_key TEXT NOT NULL,
      service_key TEXT NOT NULL DEFAULT '*',
      label TEXT NOT NULL,
      revenue_account_id INTEGER NOT NULL
        REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT accounting_revenue_mapping_scope_uniq
        UNIQUE (company_id, module_key, service_key)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS accounting_revenue_mappings_company_module_idx
      ON accounting_revenue_mappings(company_id, module_key, is_active)
  `);
  logger.info("[accountingRevenueMapping] migration ready");
}