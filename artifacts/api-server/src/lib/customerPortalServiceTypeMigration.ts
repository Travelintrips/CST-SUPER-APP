import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * CF-CP-4D additive transaction snapshot and service-scoped revenue contract.
 * This stage is development-only and never posts Central Finance entries.
 */
export async function runCustomerPortalServiceTypeMigration(): Promise<void> {
  const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? "development";
  if (env !== "development") return;

  await db.execute(sql`
    ALTER TABLE finance_project_coa_mappings
      ADD COLUMN IF NOT EXISTS service_scope TEXT
  `);
  await db.execute(sql`
    ALTER TABLE sales_documents
      ADD COLUMN IF NOT EXISTS tax_treatment TEXT,
      ADD COLUMN IF NOT EXISTS product_scope TEXT
  `);
  await db.execute(sql`
    ALTER TABLE sales_document_lines
      ADD COLUMN IF NOT EXISTS product_scope TEXT,
      ADD COLUMN IF NOT EXISTS service_scope TEXT
  `);
  await db.execute(sql`
    ALTER TABLE portal_product_orders
      ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(8,4),
      ADD COLUMN IF NOT EXISTS tax_rule_id INTEGER,
      ADD COLUMN IF NOT EXISTS tax_treatment TEXT
  `);
  await db.execute(sql`
    ALTER TABLE portal_product_order_items
      ADD COLUMN IF NOT EXISTS product_scope TEXT,
      ADD COLUMN IF NOT EXISTS service_scope TEXT
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS finance_project_coa_mappings_service_scope_idx
      ON finance_project_coa_mappings (finance_project_config_id, product_scope, service_scope)
      WHERE product_scope IS NOT NULL
  `);
  await db.execute(sql`
    INSERT INTO finance_project_tax_mappings
      (finance_project_config_id, transaction_type, tax_rule_id, product_scope,
       is_active, effective_from, metadata, created_by, updated_by)
    SELECT 3, 'sales_order', tr.id, scope.product_scope, TRUE, CURRENT_DATE,
           '{"source":"CF-CP-4D","treatment":"exclusive"}'::jsonb,
           'CF-CP-4D', 'CF-CP-4D'
      FROM tax_rules tr
      CROSS JOIN (VALUES ('goods'::text), ('jasa'::text)) AS scope(product_scope)
     WHERE tr.company_id = 1
       AND tr.transaction_type = 'sales_order'
       AND tr.tax_type = 'PPN_KELUARAN'
       AND tr.direction = 'output'
       AND tr.tax_rate = 11
       AND tr.is_active = TRUE
       AND EXISTS (
         SELECT 1 FROM finance_project_configs fpc
          WHERE fpc.id = 3 AND fpc.project_code = 'customer_portal'
            AND fpc.company_id = 1 AND fpc.is_active = TRUE
       )
       AND NOT EXISTS (
         SELECT 1 FROM finance_project_tax_mappings tm
          WHERE tm.finance_project_config_id = 3
            AND tm.transaction_type = 'sales_order'
            AND tm.product_scope = scope.product_scope
            AND tm.is_active = TRUE
       )
     ORDER BY tr.id
  `).catch(() => {});
}