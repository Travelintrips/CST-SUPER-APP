import { db } from "@workspace/db";
import { sql, isNull, or, eq, like } from "drizzle-orm";
import { logisticOrdersTable } from "@workspace/db/schema";
import { logger } from "./logger.js";
import { randomBytes } from "crypto";

export async function runShortLinksMigration(): Promise<void> {
  // ── 1. short_links table ────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS short_links (
      id serial PRIMARY KEY,
      code text NOT NULL UNIQUE,
      target_url text NOT NULL,
      context text NOT NULL DEFAULT 'general',
      ref_type text,
      ref_id text,
      hit_count integer NOT NULL DEFAULT 0,
      expires_at timestamp,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS short_links_context_idx ON short_links(context);
    CREATE INDEX IF NOT EXISTS short_links_ref_idx ON short_links(ref_type, ref_id);
  `);
  logger.info("Short links migration: short_links table ready");

  // ── 2. ensure public_rfq_token column exists on logistic_orders ─────────────
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'logistic_orders'
      ) THEN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'logistic_orders' AND column_name = 'public_rfq_token'
        ) THEN
          ALTER TABLE logistic_orders ADD COLUMN public_rfq_token TEXT UNIQUE;
        END IF;
      END IF;
    END $$;
  `);

  // ── 3. backfill NULL public_rfq_token for existing orders ───────────────────
  const ordersToFix = await db
    .select({ id: logisticOrdersTable.id })
    .from(logisticOrdersTable)
    .where(
      or(
        isNull(logisticOrdersTable.publicRfqToken),
        eq(logisticOrdersTable.publicRfqToken, "")
      )
    );

  if (ordersToFix.length > 0) {
    for (const { id } of ordersToFix) {
      const token = randomBytes(16).toString("hex");
      await db.execute(sql`
        UPDATE logistic_orders
        SET public_rfq_token = ${token}
        WHERE id = ${id} AND (public_rfq_token IS NULL OR public_rfq_token = '')
      `);
    }
    logger.info(
      { count: ordersToFix.length },
      "Short links migration: backfilled publicRfqToken for existing orders"
    );
  } else {
    logger.info("Short links migration: all orders already have publicRfqToken");
  }

  // ── 4. fix short links that have empty token (token=) in target_url ─────────
  // These links were created when the order had no publicRfqToken yet.
  // We repair them by joining rfq_number / vendor_id from the URL to the
  // actual token now stored on the order.
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'short_links') THEN
        UPDATE short_links sl
        SET target_url = (
          SELECT regexp_replace(
            sl.target_url,
            'token=$',
            'token=' || lo.public_rfq_token
          )
          FROM logistic_order_rfqs lor
          JOIN logistic_orders lo ON lo.id = lor.order_id
          WHERE sl.target_url LIKE '%/vendor-quote?%'
            AND sl.target_url LIKE '%rfq=' || lor.rfq_number || '%'
            AND lo.public_rfq_token IS NOT NULL
            AND lo.public_rfq_token <> ''
          LIMIT 1
        )
        WHERE sl.target_url LIKE '%vendor-quote%token=$'
          OR sl.target_url ~ 'token=$';
      END IF;
    END $$;
  `);
  logger.info("Short links migration: repaired empty-token vendor-quote short links");
}
