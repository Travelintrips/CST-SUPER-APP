import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Enterprise DB Patch — Phase 2: FK + Index Completion
 *
 * Rules (per spec):
 *  - All changes additive and idempotent (IF NOT EXISTS / pg_constraint guard)
 *  - FK constraints added as NOT VALID: enforces new inserts immediately but does
 *    not scan existing rows — safe for production tables that could not be orphan-
 *    verified against live data.  Run VALIDATE CONSTRAINT manually after confirming
 *    data cleanliness.
 *  - No NOT NULL additions, no column drops, no renames, no API or frontend changes.
 *  - pgBouncer transaction-mode compatible: each call is a single SQL statement.
 *    DO-block approach avoided: Drizzle mangling of $-sequences in sql.raw strings
 *    caused DO $ ... $ to arrive at PG as DO $ ... $, breaking execution.
 */
export async function runPhase2Migration(): Promise<void> {
  // ── Helper: idempotent FK addition ─────────────────────────────────────────
  // Uses three separate db.execute() calls — avoids DO-block dollar-quoting
  // which Drizzle mangles in sql.raw strings, and is compatible with pgBouncer
  // transaction mode (each call is exactly one SQL statement).
  const addFk = async (
    constraintName: string,
    table: string,
    col: string,
    refTable: string,
    refCol: string = "id",
    onDelete: string = "NO ACTION"
  ) => {
    try {
      // 1. Skip if constraint name already exists
      const byName = await db.execute(
        sql`SELECT 1 FROM pg_constraint WHERE conname = ${constraintName} LIMIT 1`
      );
      if (byName.rows.length > 0) return;

      // 2. Skip if an equivalent FK already exists under any name
      const byEquiv = await db.execute(sql.raw(`
        SELECT 1
        FROM pg_constraint c
        JOIN pg_attribute a
          ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
        WHERE c.contype = 'f'
          AND c.conrelid = 'public.${table}'::regclass
          AND a.attname = '${col}'
          AND c.confrelid = 'public.${refTable}'::regclass
        LIMIT 1
      `));
      if (byEquiv.rows.length > 0) return;

      // 3. Add the FK — single DDL statement, no DO block
      await db.execute(sql.raw(`
        ALTER TABLE public.${table}
          ADD CONSTRAINT ${constraintName}
          FOREIGN KEY (${col})
          REFERENCES public.${refTable}(${refCol})
          ON DELETE ${onDelete}
          NOT VALID
      `));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[Phase2Migration] FK ${constraintName} skipped: ${msg}`);
    }
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // B. INDEX COMPLETION — Missing high-impact indexes
  // ══════════════════════════════════════════════════════════════════════════════

  // ── sales_documents — no company_id index exists at all ──────────────────
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS sales_docs_company_idx
      ON public.sales_documents (company_id)
      WHERE company_id IS NOT NULL;
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS sales_docs_company_status_idx
      ON public.sales_documents (company_id, status)
      WHERE company_id IS NOT NULL;
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS sales_docs_company_created_idx
      ON public.sales_documents (company_id, created_at DESC)
      WHERE company_id IS NOT NULL;
  `);

  // ── vendor_fulfillment_links — only token_hash index exists ──────────────
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS vfl_order_idx
      ON public.vendor_fulfillment_links (order_id);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS vfl_vendor_idx
      ON public.vendor_fulfillment_links (vendor_id)
      WHERE vendor_id IS NOT NULL;
  `);

  // ── logistic_orders — email for public order tracking (guest lookup) ──────
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS lo_email_idx
      ON public.logistic_orders (email)
      WHERE email IS NOT NULL;
  `);
  // Composite (company_id, status) — more efficient than two separate index scans
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS lo_company_status_comp_idx
      ON public.logistic_orders (company_id, status)
      WHERE company_id IS NOT NULL;
  `);

  // ── payments — composite indexes for filtered queries ────────────────────
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS payments_company_status_idx
      ON public.payments (company_id, status)
      WHERE company_id IS NOT NULL;
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS payments_company_created_idx
      ON public.payments (company_id, created_at DESC)
      WHERE company_id IS NOT NULL;
  `);

  // ── purchase_documents — composite + created_by filter ────────────────────
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS purchase_docs_company_status_comp_idx
      ON public.purchase_documents (company_id, status)
      WHERE company_id IS NOT NULL;
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS purchase_docs_created_by_idx
      ON public.purchase_documents (created_by_id)
      WHERE created_by_id IS NOT NULL;
  `);

  // ── transactions — composite for time-range reporting ────────────────────
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS transactions_company_created_idx
      ON public.transactions (company_id, created_at DESC)
      WHERE company_id IS NOT NULL;
  `);

  // ── stocks — composite for inventory filtering ────────────────────────────
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS stocks_company_supplier_idx
      ON public.stocks (company_id, supplier_id)
      WHERE company_id IS NOT NULL;
  `);

  // ── rfq_vendor_links — vendor_id lookup (rfq_id already indexed) ─────────
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS rfq_vendor_links_vendor_id_idx
      ON public.rfq_vendor_links (vendor_id)
      WHERE vendor_id IS NOT NULL;
  `);

  // ══════════════════════════════════════════════════════════════════════════════
  // A. FOREIGN KEY GAP — All candidates verified orphan_count = 0 on dev.
  //    Added as NOT VALID for backward-compatibility with prod data.
  //    Enforces referential integrity for all new writes immediately.
  // ══════════════════════════════════════════════════════════════════════════════

  // payments.company_id → companies
  await addFk("fk_payments_company", "payments", "company_id", "companies", "id", "SET NULL");

  // stocks.company_id → companies, stocks.supplier_id → suppliers
  await addFk("fk_stocks_company",   "stocks", "company_id",   "companies", "id", "SET NULL");
  await addFk("fk_stocks_supplier",  "stocks", "supplier_id",  "suppliers", "id", "SET NULL");

  // driver_jobs.company_id → companies, driver_jobs.driver_id → drivers
  await addFk("fk_driver_jobs_company", "driver_jobs", "company_id", "companies", "id", "SET NULL");
  await addFk("fk_driver_jobs_driver",  "driver_jobs", "driver_id",  "drivers",   "id", "SET NULL");

  // logistic_orders.company_id → companies
  await addFk("fk_logistic_orders_company", "logistic_orders", "company_id", "companies", "id", "SET NULL");

  // logistic_order_items.order_id → logistic_orders (structural — line items)
  await addFk("fk_logistic_order_items_order", "logistic_order_items", "order_id", "logistic_orders", "id", "NO ACTION");

  // mkt_rfqs.company_id → companies
  await addFk("fk_mkt_rfqs_company", "mkt_rfqs", "company_id", "companies", "id", "SET NULL");

  // mkt_rfq_lines.rfq_id → mkt_rfqs (structural)
  await addFk("fk_mkt_rfq_lines_rfq", "mkt_rfq_lines", "rfq_id", "mkt_rfqs", "id", "NO ACTION");

  // mkt_purchase_orders.rfq_id → mkt_rfqs, .company_id → companies
  await addFk("fk_mkt_po_rfq",     "mkt_purchase_orders", "rfq_id",     "mkt_rfqs",   "id", "NO ACTION");
  await addFk("fk_mkt_po_company", "mkt_purchase_orders", "company_id", "companies",  "id", "SET NULL");

  // mkt_vendor_quotes.rfq_id → mkt_rfqs, .vendor_id → suppliers
  // vendor_id is NOT NULL → NO ACTION (SET NULL would violate column constraint)
  await addFk("fk_mkt_vq_rfq",    "mkt_vendor_quotes", "rfq_id",    "mkt_rfqs",  "id", "NO ACTION");
  await addFk("fk_mkt_vq_vendor", "mkt_vendor_quotes", "vendor_id", "suppliers", "id", "NO ACTION");

  // purchase_documents.company_id → companies
  await addFk("fk_purchase_docs_company", "purchase_documents", "company_id", "companies", "id", "SET NULL");

  // purchase_document_lines.document_id → purchase_documents (structural)
  await addFk("fk_purchase_doc_lines_doc", "purchase_document_lines", "document_id", "purchase_documents", "id", "NO ACTION");

  // sales_documents.company_id → companies
  await addFk("fk_sales_docs_company", "sales_documents", "company_id", "companies", "id", "SET NULL");

  // sales_document_lines.document_id → sales_documents (structural)
  await addFk("fk_sales_doc_lines_doc", "sales_document_lines", "document_id", "sales_documents", "id", "NO ACTION");

  // expenses.company_id → companies
  // company_id is NOT NULL → NO ACTION (SET NULL would violate column constraint)
  await addFk("fk_expenses_company", "expenses", "company_id", "companies", "id", "NO ACTION");

  // vendor_fulfillment_links.order_id → logistic_orders, .vendor_id → suppliers
  await addFk("fk_vfl_order",  "vendor_fulfillment_links", "order_id",  "logistic_orders", "id", "NO ACTION");
  await addFk("fk_vfl_vendor", "vendor_fulfillment_links", "vendor_id", "suppliers",       "id", "SET NULL");

  // rfq_vendor_links.rfq_id → mkt_rfqs, .vendor_id → suppliers
  // vendor_id is NOT NULL → NO ACTION (SET NULL would violate column constraint)
  await addFk("fk_rfq_vl_rfq",    "rfq_vendor_links", "rfq_id",    "mkt_rfqs",  "id", "NO ACTION");
  await addFk("fk_rfq_vl_vendor", "rfq_vendor_links", "vendor_id", "suppliers", "id", "NO ACTION");

  // ══════════════════════════════════════════════════════════════════════════════
  // D. ISOLATION FOLLOW-UP — Documented, not backfilled (source unclear)
  //
  // transactions.company_id:
  //   Table is POS-style (product_name, quantity, unit_price, cashier_id TEXT).
  //   No FK column to derive company from — cashier_id is TEXT, not a user FK.
  //   Action: MANUAL MAPPING REQUIRED. Query by cashier_id → users → company_id
  //   once user-cashier relationship is established.
  //
  // stocks.company_id:
  //   Has supplier_id → suppliers, but supplier.company_id may not always be set.
  //   Dev table is empty (0 rows). No backfill risk.
  //   Potential source: stocks.supplier_id → suppliers.company_id when NOT NULL.
  //   Action: SAFE TO BACKFILL via:
  //     UPDATE stocks s SET company_id = sup.company_id
  //     FROM suppliers sup
  //     WHERE s.supplier_id = sup.id AND s.company_id IS NULL AND sup.company_id IS NOT NULL;
  //   Run manually after verifying supplier→company mapping is complete.
  // ══════════════════════════════════════════════════════════════════════════════

  logger.info("[Phase2Migration] ok — FK constraints (NOT VALID) + missing indexes applied");
}
