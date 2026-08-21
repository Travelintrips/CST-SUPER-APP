import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * CF-CP-4D additive transaction snapshot and service-scoped revenue contract.
 *
 * Version 2 also repairs the original tax-mapping identity index. The first
 * version attempted to seed goods and jasa, but the legacy unique index did
 * not include product_scope, so PostgreSQL rejected the two-row insert.
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
    DROP INDEX IF EXISTS uq_finance_project_tax_mappings_identity
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_project_tax_mappings_identity
      ON finance_project_tax_mappings (
        finance_project_config_id,
        transaction_type,
        COALESCE(payment_method, ''),
        COALESCE(provider_code, ''),
        COALESCE(product_scope, ''),
        effective_from
      )
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
   `);

  await db.execute(sql`
    INSERT INTO finance_project_coa_mappings (
      finance_project_config_id, account_role, coa_id, product_scope,
      service_scope, payment_method, provider_code, is_active, effective_from,
      effective_to, metadata, created_by, updated_by
    )
    SELECT 3, 'REVENUE', mapping.coa_id, 'jasa', mapping.service_scope,
           NULL, NULL, TRUE, CURRENT_DATE, NULL,
           jsonb_build_object(
             'source', 'CF-CP-6B',
             'evidence', 'canonical service type and company-1 CST revenue COA',
             'service_code', mapping.service_scope,
             'account_code', mapping.account_code
           ),
           'CF-CP-6B', 'CF-CP-6B'
      FROM (
        VALUES
          ('trucking'::text, '4-1013-CST'::text),
          ('sea_freight'::text, '4-1011-CST'::text),
          ('air_freight'::text, '4-1012-CST'::text),
          ('ppjk'::text, '4-1014-CST'::text),
          ('handling'::text, '4-1018-CST'::text),
          ('document'::text, '4-1019-CST'::text)
      ) AS mapping(service_scope, account_code)
      JOIN chart_of_accounts ca
        ON ca.company_id = 1
       AND ca.code = mapping.account_code
       AND ca.is_active = TRUE
       AND ca.is_postable = TRUE
     WHERE EXISTS (
       SELECT 1
         FROM finance_project_configs
        WHERE id = 3
          AND project_code = 'customer_portal'
          AND company_id = 1
          AND is_active = TRUE
     )
       AND NOT EXISTS (
       SELECT 1
         FROM finance_project_coa_mappings existing
        WHERE existing.finance_project_config_id = 3
          AND existing.account_role = 'REVENUE'
          AND existing.product_scope = 'jasa'
          AND lower(existing.service_scope) = lower(mapping.service_scope)
          AND existing.is_active = TRUE
          AND existing.effective_from <= CURRENT_DATE
          AND (existing.effective_to IS NULL OR CURRENT_DATE < existing.effective_to)
     )
    RETURNING id
  `);
}