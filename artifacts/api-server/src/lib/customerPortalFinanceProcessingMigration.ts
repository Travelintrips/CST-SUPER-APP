import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function runCustomerPortalFinanceProcessingMigration(): Promise<void> {
  const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? "development";
  if (env !== "development") return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customer_finance_processing (
      id BIGSERIAL PRIMARY KEY,
      source_project TEXT NOT NULL,
      source_payment_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','processing','posted','failed','manual_review')),
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      locked_at TIMESTAMPTZ,
      last_error TEXT,
      processed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (source_project, source_payment_id, event_type),
      UNIQUE (correlation_id)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS customer_finance_processing_claim_idx
      ON customer_finance_processing (status, available_at, locked_at)
  `);
}