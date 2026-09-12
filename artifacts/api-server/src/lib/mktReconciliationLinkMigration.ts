import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Sprint 09E additive schema.
 *
 * This table stores only the Marketplace canonical reference passed to the
 * existing Bank Reconciliation module. It intentionally does not alter bank
 * mutations, matches, journals, or reconciliation status.
 */
export async function runMktReconciliationLinkMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS mkt_reconciliation_links (
      id SERIAL PRIMARY KEY,
      link_key TEXT NOT NULL,
      correlation_reference TEXT NOT NULL,
      payload_fingerprint TEXT NOT NULL,
      accounting_handoff_id INTEGER NOT NULL
        REFERENCES mkt_accounting_handoffs(id) ON DELETE RESTRICT,
      ap_preparation_id INTEGER NOT NULL
        REFERENCES mkt_ap_preparations(id) ON DELETE RESTRICT,
      mkt_purchase_order_id INTEGER NOT NULL
        REFERENCES mkt_purchase_orders(id) ON DELETE RESTRICT,
      payment_request_id INTEGER NOT NULL
        REFERENCES payment_requests(id) ON DELETE RESTRICT,
      company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      supplier_id INTEGER NOT NULL
        REFERENCES suppliers(id) ON DELETE RESTRICT,
      currency TEXT NOT NULL,
      amount NUMERIC(14, 2) NOT NULL,
      payment_reference TEXT NOT NULL,
      accounting_reference TEXT NOT NULL,
      marketplace_reference TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      payload JSONB NOT NULL,
      requested_by TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS mkt_reconciliation_links_key_unique
      ON mkt_reconciliation_links (link_key)
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS mkt_reconciliation_links_correlation_unique
      ON mkt_reconciliation_links (correlation_reference)
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS mkt_reconciliation_links_handoff_unique
      ON mkt_reconciliation_links (accounting_handoff_id)
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS mkt_reconciliation_links_payment_unique
      ON mkt_reconciliation_links (payment_request_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS mkt_reconciliation_links_po_idx
      ON mkt_reconciliation_links (mkt_purchase_order_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS mkt_reconciliation_links_company_idx
      ON mkt_reconciliation_links (company_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS mkt_reconciliation_links_status_idx
      ON mkt_reconciliation_links (status)
  `);
  logger.info("[mktReconciliationLinkMigration] Sprint 09E link schema applied");
}