import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runEnterpriseMigration(): Promise<void> {
  try {
    // 1. Add columns to logistic_order_rfqs — batched
    await db.execute(sql`
      ALTER TABLE logistic_order_rfqs
        ADD COLUMN IF NOT EXISTS response_deadline TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS created_by_user_id TEXT,
        ADD COLUMN IF NOT EXISTS created_by_user_name TEXT;
    `);

    // 2. Add rank columns to logistic_order_quotes — batched
    await db.execute(sql`
      ALTER TABLE logistic_order_quotes
        ADD COLUMN IF NOT EXISTS rank_score NUMERIC(6,2),
        ADD COLUMN IF NOT EXISTS rank_badges TEXT[] DEFAULT '{}';
    `);

    // 3. Add operational/payment columns to logistic_orders — batched
    await db.execute(sql`
      ALTER TABLE logistic_orders
        ADD COLUMN IF NOT EXISTS operational_status TEXT,
        ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid';
    `);

    // 4. Add quotation columns to customer_quote_links — batched
    await db.execute(sql`
      ALTER TABLE customer_quote_links
        ADD COLUMN IF NOT EXISTS quotation_pdf_url TEXT,
        ADD COLUMN IF NOT EXISTS quotation_number TEXT;
    `);

    // 5. Create margin_rules table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS margin_rules (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        service_type TEXT,
        route TEXT,
        customer_type TEXT,
        margin_type TEXT NOT NULL DEFAULT 'percentage',
        margin_value NUMERIC(14,2) NOT NULL DEFAULT 0,
        minimum_margin NUMERIC(14,2),
        is_active BOOLEAN NOT NULL DEFAULT true,
        priority NUMERIC(5,0) NOT NULL DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 6. Create activity_logs table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id SERIAL PRIMARY KEY,
        rfq_id INTEGER,
        order_id INTEGER,
        actor_type TEXT NOT NULL DEFAULT 'admin',
        actor_id TEXT,
        actor_name TEXT,
        action TEXT NOT NULL,
        old_value JSONB,
        new_value JSONB,
        description TEXT,
        ip_address TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 7. Index on activity_logs for fast lookup
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS activity_logs_order_idx ON activity_logs(order_id);
      CREATE INDEX IF NOT EXISTS activity_logs_rfq_idx ON activity_logs(rfq_id);
    `);

    // 8. Add missing columns to rfq_vendor_links (idempotent)
    await db.execute(sql`
      ALTER TABLE rfq_vendor_links
        ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS lead_time_days INTEGER,
        ADD COLUMN IF NOT EXISTS stock_availability TEXT DEFAULT 'unknown';
    `);

    // 10. Optimistic locking: version column on logistic_orders
    await db.execute(sql`
      ALTER TABLE logistic_orders
        ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
    `);

    // 9. Race-condition / idempotency unique constraints
    //    - logistic_order_quotes: one vendor may submit at most one quote per RFQ
    //    - vendor_responses: one READY/NOT_READY row per order number (upsert target)
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS liq_rfq_vendor_uidx
        ON logistic_order_quotes (rfq_id, vendor_id);
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS vendor_responses_order_uidx
        ON vendor_responses (order_number);
    `);

    logger.info("Enterprise migration completed successfully");
  } catch (err) {
    logger.error({ err }, "Enterprise migration failed");
    throw err;
  }
}
