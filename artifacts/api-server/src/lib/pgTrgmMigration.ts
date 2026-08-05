import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Phase 1 performance indexes — pg_trgm for ILIKE search + btree indexes
 * for the highest-traffic lookup columns.
 *
 * All statements are idempotent (IF NOT EXISTS / CREATE INDEX IF NOT EXISTS).
 */
export async function runPgTrgmMigration(): Promise<void> {
  try {
    // 1. Enable pg_trgm extension (requires superuser, no-op if already enabled)
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);

    // 2. GIN trigram indexes on logistic_orders — speeds up ILIKE '%...%' search
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS lo_customer_name_trgm_idx
        ON logistic_orders USING gin (customer_name gin_trgm_ops);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS lo_company_name_trgm_idx
        ON logistic_orders USING gin (company_name gin_trgm_ops);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS lo_order_number_trgm_idx
        ON logistic_orders USING gin (order_number gin_trgm_ops);
    `);

    // 3. Btree index on logistic_orders.created_at — used for ORDER BY + date filters
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS lo_created_at_desc_idx
        ON logistic_orders (created_at DESC);
    `);

    // 4. Btree index on logistic_orders.status — used for status filter
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS lo_status_idx
        ON logistic_orders (status)
        WHERE status NOT IN ('Completed', 'Cancelled');
    `);

    // 5. Btree index on logistic_order_rfqs.order_id + created_at — used in track + list queries
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS lor_order_id_created_idx
        ON logistic_order_rfqs (order_id, created_at DESC);
    `);

    // 6. Btree index on driver_jobs.logistic_order_id + assigned_at — used in track endpoint
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS dj_order_assigned_idx
        ON driver_jobs (logistic_order_id, assigned_at DESC);
    `);

    // 7 & 8. pod_ocr_results indexes — only if the table exists (created by Drizzle push separately)
    await db.execute(sql`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pod_ocr_results') THEN
          CREATE INDEX IF NOT EXISTS por_order_id_idx
            ON pod_ocr_results (order_id)
            WHERE order_id IS NOT NULL;
          CREATE INDEX IF NOT EXISTS por_pending_idx
            ON pod_ocr_results (id)
            WHERE verification_status = 'pending';
        END IF;
      END $$;
    `);

    logger.info("pg_trgm migration completed successfully");
  } catch (err) {
    logger.error({ err }, "pg_trgm migration failed");
    throw err;
  }
}
