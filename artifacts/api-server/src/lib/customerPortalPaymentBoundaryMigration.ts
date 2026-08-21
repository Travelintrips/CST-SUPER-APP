import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * CF-CP-2 additive schema stage. This boundary is intentionally development
 * only; production keeps the legacy payment path and receives no new table.
 */
export async function runCustomerPortalPaymentBoundaryMigration(): Promise<void> {
  const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? "development";
  if (env !== "development") return;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customer_payment_finance_events (
      id BIGSERIAL PRIMARY KEY,
      source_project TEXT NOT NULL,
      source_payment_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      company_id INTEGER NOT NULL,
      customer_id INTEGER,
      sales_document_id INTEGER,
      order_id INTEGER,
      amount NUMERIC(14,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'IDR',
      payment_method TEXT,
      payment_provider TEXT,
      provider_reference TEXT,
      paid_at TIMESTAMPTZ NOT NULL,
      confirmed_at TIMESTAMPTZ NOT NULL,
      product_scope TEXT,
      service_scope TEXT,
      tax_rule_id INTEGER,
      tax_rate NUMERIC(8,4),
      tax_amount NUMERIC(14,2),
      tax_treatment TEXT,
      schema_version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT customer_payment_finance_events_identity
        UNIQUE (source_project, source_payment_id, event_type),
      CONSTRAINT customer_payment_finance_events_correlation_unique
        UNIQUE (correlation_id)
    )
  `);
  await db.execute(sql`
    ALTER TABLE customer_payment_finance_events
      ADD COLUMN IF NOT EXISTS product_scope TEXT,
      ADD COLUMN IF NOT EXISTS service_scope TEXT,
      ADD COLUMN IF NOT EXISTS tax_rule_id INTEGER,
      ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(8,4),
      ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(14,2),
      ADD COLUMN IF NOT EXISTS tax_treatment TEXT
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS customer_payment_finance_events_payment_idx
      ON customer_payment_finance_events (source_payment_id)
  `);
}