import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * CF-CP-4A additive contract extension.
 *
 * Product scope is deliberately nullable so existing projects keep resolving
 * exactly as before. This stage only adds the discriminator contract; it does
 * not invent tax rules or create Customer Portal mappings.
 */
export async function runCustomerPortalProductTaxMigration(): Promise<void> {
  const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? "development";
  if (env !== "development") return;

  await db.execute(sql`
    ALTER TABLE finance_project_tax_mappings
      ADD COLUMN IF NOT EXISTS product_scope TEXT
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS finance_project_tax_mappings_product_scope_idx
      ON finance_project_tax_mappings (finance_project_config_id, product_scope)
      WHERE product_scope IS NOT NULL
  `);
}