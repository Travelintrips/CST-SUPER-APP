import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * ENTERPRISE DB PHASE 3C — Order Links Cross-Reference Table (boot migration)
 *
 * Creates one additive, idempotent table: public.order_links
 *
 * Rules enforced:
 *   - Additive only. No existing table is merged, dropped, renamed, or altered.
 *   - No write path, API route, or frontend behavior is touched.
 *   - CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS only — safe to
 *     re-run on every boot.
 *   - source_table/target_table are polymorphic string columns; deliberately
 *     NOT foreign-keyed against any physical table (a table name can point
 *     at orders, logistic_orders, mkt_rfqs, invoices, etc — a real FK would
 *     require one column per target domain).
 */
const EXPECTED_INDEXES = [
  "order_links_company_id_idx",
  "order_links_source_idx",
  "order_links_target_idx",
  "order_links_link_type_idx",
  "order_links_relation_status_idx",
] as const;

export async function runOrderLinksMigration(): Promise<void> {
  // Table + index DDL — no .catch() swallowing here. IF NOT EXISTS already
  // makes every statement idempotent/safe to re-run; a real failure (e.g.
  // permissions, connection drop) must surface via runWithRetry, not be
  // silently absorbed and reported as "ready".
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS order_links (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      target_table TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      link_type TEXT NOT NULL,
      relation_status TEXT NOT NULL DEFAULT 'active',
      metadata JSONB,
      created_by TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `));

  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS order_links_company_id_idx ON order_links (company_id)`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS order_links_source_idx ON order_links (source_table, source_id)`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS order_links_target_idx ON order_links (target_table, target_id)`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS order_links_link_type_idx ON order_links (link_type)`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS order_links_relation_status_idx ON order_links (relation_status)`));

  // Post-migration verification — only report "ready" once table + all
  // expected indexes are confirmed present. If anything is missing, throw
  // so runWithRetry surfaces the failure instead of a false-positive log.
  const tableCheck = await db.execute(sql.raw(
    `SELECT to_regclass('public.order_links') IS NOT NULL AS exists`
  ));
  const tableRows = (tableCheck.rows ?? tableCheck) as Array<{ exists: boolean }>;
  if (!tableRows?.[0]?.exists) {
    throw new Error("[OrderLinksMigration] verification failed: order_links table not found after CREATE TABLE");
  }

  const indexCheck = await db.execute(sql.raw(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'order_links'`
  ));
  const indexRows = (indexCheck.rows ?? indexCheck) as Array<{ indexname: string }>;
  const foundIndexNames = new Set(indexRows.map((r) => r.indexname));
  const missingIndexes = EXPECTED_INDEXES.filter((name) => !foundIndexNames.has(name));
  if (missingIndexes.length > 0) {
    throw new Error(`[OrderLinksMigration] verification failed: missing indexes ${missingIndexes.join(", ")}`);
  }

  logger.info("[OrderLinksMigration] order_links table + indexes verified ready (Phase 3C)");
}
