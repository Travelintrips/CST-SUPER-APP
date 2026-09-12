import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Customer notifications are deliberately separate from admin/vendor feeds.
 * The unique logical key makes lifecycle retries safe and lets the UI reload
 * missed events after an SSE disconnect.
 */
export async function runCustomerPortalNotificationsMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS portal_customer_notifications (
      id                SERIAL PRIMARY KEY,
      portal_customer_id INTEGER NOT NULL REFERENCES portal_customers(id) ON DELETE CASCADE,
      event_key         TEXT NOT NULL,
      type              TEXT NOT NULL,
      title             TEXT NOT NULL,
      message           TEXT NOT NULL,
      payload           JSONB NOT NULL DEFAULT '{}',
      is_read           BOOLEAN NOT NULL DEFAULT FALSE,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      read_at           TIMESTAMPTZ,
      CONSTRAINT portal_customer_notifications_event_key_uq
        UNIQUE (portal_customer_id, event_key)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS pcn_customer_created_idx
      ON portal_customer_notifications (portal_customer_id, created_at DESC)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS pcn_customer_unread_idx
      ON portal_customer_notifications (portal_customer_id, is_read, created_at DESC)
  `);
  logger.info("Customer portal notifications migration: selesai");
}