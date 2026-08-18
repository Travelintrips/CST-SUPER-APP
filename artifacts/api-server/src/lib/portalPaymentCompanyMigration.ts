import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Reconcile company ownership for legacy portal financial records.
 *
 * Only memberships with exactly one distinct active company are eligible for
 * automatic backfill. Ambiguous and unknown records remain NULL and are
 * therefore excluded by the fail-closed payment/reconciliation guards.
 */
export async function runPortalPaymentCompanyMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE portal_product_orders
    ADD COLUMN IF NOT EXISTS company_id INTEGER
  `);

  await db.execute(sql`
    WITH eligible_memberships AS (
      SELECT portal_customer_id, MIN(company_id) AS company_id
      FROM portal_company_members
      WHERE is_active = TRUE
      GROUP BY portal_customer_id
      HAVING COUNT(DISTINCT company_id) = 1
    )
    UPDATE sales_documents sd
    SET company_id = em.company_id
    FROM eligible_memberships em
    WHERE sd.company_id IS NULL
      AND sd.created_by_id ~ '^portal:[0-9]+$'
      AND split_part(sd.created_by_id, ':', 2)::INTEGER = em.portal_customer_id
  `).catch((error: unknown) => {
    logger.warn({ error }, "[portalCompanyScope] sales_documents backfill skipped");
  });

  await db.execute(sql`
    WITH eligible_memberships AS (
      SELECT pcm.portal_customer_id, MIN(pcm.company_id) AS company_id
      FROM portal_company_members pcm
      WHERE pcm.is_active = TRUE
      GROUP BY pcm.portal_customer_id
      HAVING COUNT(DISTINCT pcm.company_id) = 1
    )
    UPDATE portal_product_orders ppo
    SET company_id = em.company_id
    FROM portal_customers pc
    JOIN eligible_memberships em ON em.portal_customer_id = pc.id
    WHERE ppo.company_id IS NULL
      AND LOWER(ppo.email) = LOWER(pc.email)
  `).catch((error: unknown) => {
    logger.warn({ error }, "[portalCompanyScope] portal_product_orders backfill skipped");
  });

  await db.execute(sql`
    UPDATE payments p
    SET company_id = sd.company_id
    FROM sales_documents sd
    WHERE p.company_id IS NULL
      AND sd.company_id IS NOT NULL
      AND (
        (p.reference_type = 'sales_document' AND p.reference_id = sd.id)
        OR (p.sales_doc_id = sd.id)
      )
  `).catch((error: unknown) => {
    logger.warn({ error }, "[portalCompanyScope] payments sales-document backfill skipped");
  });

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_portal_product_orders_company
    ON portal_product_orders(company_id)
  `).catch(() => {});
}