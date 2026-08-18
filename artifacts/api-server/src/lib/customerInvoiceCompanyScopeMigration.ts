import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

async function relationExists(relationName: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT to_regclass(${`public.${relationName}`}) IS NOT NULL AS exists
  `);
  return Boolean((result.rows[0] as { exists?: unknown } | undefined)?.exists);
}

/**
 * Additive repair for runtime databases where the legacy vendor mini-form
 * stage was already marked complete before customer_invoice_links.company_id
 * was introduced.
 *
 * Ownership is copied only from canonical parent records. Unresolved legacy
 * rows remain NULL and are intentionally review-only; payment confirmation
 * routes reject them rather than guessing a tenant from customer details.
 */
export async function runCustomerInvoiceCompanyScopeMigration(): Promise<void> {
  if (!(await relationExists("customer_invoice_links"))) {
    throw new Error(
      "customer_invoice_links is missing; vendor mini form migration must run before customer invoice company scope",
    );
  }

  await db.execute(sql`
    ALTER TABLE customer_invoice_links
      ADD COLUMN IF NOT EXISTS company_id INTEGER
  `);

  if (await relationExists("sales_documents")) {
    await db.execute(sql`
      UPDATE customer_invoice_links cil
      SET company_id = sd.company_id
      FROM sales_documents sd
      WHERE cil.company_id IS NULL
        AND cil.sales_doc_id = sd.id
        AND sd.company_id IS NOT NULL
    `);
  }

  if (await relationExists("logistic_orders")) {
    await db.execute(sql`
      UPDATE customer_invoice_links cil
      SET company_id = lo.company_id
      FROM logistic_orders lo
      WHERE cil.company_id IS NULL
        AND cil.order_id = lo.id
        AND lo.company_id IS NOT NULL
    `);
  }

  if (await relationExists("portal_product_orders")) {
    await db.execute(sql`
      UPDATE customer_invoice_links cil
      SET company_id = ppo.company_id
      FROM portal_product_orders ppo
      WHERE cil.company_id IS NULL
        AND cil.order_id = ppo.id
        AND ppo.company_id IS NOT NULL
    `);
  }

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS cil_company_id_idx
      ON customer_invoice_links(company_id)
      WHERE company_id IS NOT NULL
  `);

  const columnCheck = await db.execute(sql`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customer_invoice_links'
      AND column_name = 'company_id'
      AND data_type = 'integer'
    LIMIT 1
  `);
  if (columnCheck.rows.length !== 1) {
    throw new Error("customer_invoice_links.company_id verification failed");
  }

  const indexCheck = await db.execute(sql`
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'customer_invoice_links'
      AND indexname = 'cil_company_id_idx'
    LIMIT 1
  `);
  if (indexCheck.rows.length !== 1) {
    throw new Error("customer_invoice_links.cil_company_id_idx verification failed");
  }

  const unresolvedPaid = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM customer_invoice_links
    WHERE payment_status = 'paid'
      AND company_id IS NULL
  `);
  const unresolvedPaidCount = Number(
    (unresolvedPaid.rows[0] as { count?: unknown } | undefined)?.count ?? 0,
  );

  if (unresolvedPaidCount > 0) {
    logger.warn(
      { unresolved_paid_invoice_count: unresolvedPaidCount },
      "[customerInvoiceCompanyScope] paid legacy invoices remain without company; payment routes stay fail-closed",
    );
  } else {
    logger.info("[customerInvoiceCompanyScope] no paid invoices remain without company");
  }

  logger.info(
    { unresolved_paid_invoice_count: unresolvedPaidCount },
    "[customerInvoiceCompanyScope] column, index, and paid-row verification complete",
  );
}