import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Sprint 09D additive schema.
 *
 * This table stores Marketplace evidence and Accounting handoff status only.
 * It intentionally does not add or modify accounting journal tables.
 */
export async function runMktAccountingHandoffMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS mkt_accounting_handoffs (
      id SERIAL PRIMARY KEY,
      handoff_key TEXT NOT NULL,
      correlation_reference TEXT NOT NULL,
      payload_fingerprint TEXT NOT NULL,
      ap_preparation_id INTEGER NOT NULL
        REFERENCES mkt_ap_preparations(id) ON DELETE RESTRICT,
      vendor_invoice_id INTEGER NOT NULL
        REFERENCES vendor_invoices(id) ON DELETE RESTRICT,
      mkt_purchase_order_id INTEGER NOT NULL
        REFERENCES mkt_purchase_orders(id) ON DELETE RESTRICT,
      mkt_goods_receipt_id INTEGER NOT NULL
        REFERENCES mkt_po_goods_receipts(id) ON DELETE RESTRICT,
      payment_request_id INTEGER NOT NULL
        REFERENCES payment_requests(id) ON DELETE RESTRICT,
      company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      supplier_id INTEGER NOT NULL
        REFERENCES suppliers(id) ON DELETE RESTRICT,
      currency TEXT NOT NULL,
      amount NUMERIC(14, 2) NOT NULL,
      approval_state TEXT NOT NULL,
      payment_lifecycle_state TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'accepted',
      accounting_reference TEXT,
      accounting_status TEXT,
      failure_code TEXT,
      failure_reason TEXT,
      payload JSONB NOT NULL,
      requested_by TEXT,
      accepted_at TIMESTAMP,
      last_response_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS mkt_accounting_handoffs_key_unique
      ON mkt_accounting_handoffs (handoff_key)
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS mkt_accounting_handoffs_correlation_unique
      ON mkt_accounting_handoffs (correlation_reference)
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS mkt_accounting_handoffs_ap_unique
      ON mkt_accounting_handoffs (ap_preparation_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS mkt_accounting_handoffs_company_idx
      ON mkt_accounting_handoffs (company_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS mkt_accounting_handoffs_status_idx
      ON mkt_accounting_handoffs (status)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS mkt_accounting_handoffs_payment_idx
      ON mkt_accounting_handoffs (payment_request_id)
  `);
  logger.info("[mktAccountingHandoffMigration] Sprint 09D handoff schema applied");
}