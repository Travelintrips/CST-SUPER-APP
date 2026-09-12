import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * CF-CP-4B: additive product discriminator plus the one revenue mapping that
 * is proven by the canonical company-1 COA and catalog semantics.
 */
export async function runCustomerPortalProductCoaMigration(): Promise<void> {
  const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? "development";
  if (env !== "development") return;

  await db.execute(sql`
    ALTER TABLE finance_project_coa_mappings
      ADD COLUMN IF NOT EXISTS product_scope TEXT
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS finance_project_coa_mappings_product_scope_idx
      ON finance_project_coa_mappings (finance_project_config_id, product_scope)
      WHERE product_scope IS NOT NULL
  `);
  await db.execute(sql`
    INSERT INTO finance_project_coa_mappings (
      finance_project_config_id, account_role, coa_id, product_scope,
      payment_method, provider_code, is_active, effective_from, effective_to,
      metadata, created_by, updated_by
    )
    SELECT 3, 'REVENUE', 49121, 'goods', NULL, NULL, TRUE, CURRENT_DATE, NULL,
           '{"source":"CF-CP-4B","evidence":"canonical company-1 goods revenue COA"}'::jsonb,
           'CF-CP-4B', 'CF-CP-4B'
    WHERE EXISTS (
      SELECT 1 FROM finance_project_configs
       WHERE id = 3 AND project_code = 'customer_portal'
         AND company_id = 1 AND is_active = TRUE
    )
      AND EXISTS (
        SELECT 1 FROM chart_of_accounts
         WHERE id = 49121 AND company_id = 1 AND is_active = TRUE
           AND is_postable = TRUE
      )
      AND NOT EXISTS (
        SELECT 1 FROM finance_project_coa_mappings
         WHERE finance_project_config_id = 3
           AND account_role = 'REVENUE'
           AND product_scope = 'goods'
      )
  `);
}