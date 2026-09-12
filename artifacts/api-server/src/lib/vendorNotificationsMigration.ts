import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runVendorNotificationsMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vendor_notifications (
      id          SERIAL PRIMARY KEY,
      vendor_id   INTEGER NOT NULL REFERENCES portal_customers(id) ON DELETE CASCADE,
      type        TEXT    NOT NULL,
      title       TEXT    NOT NULL,
      message     TEXT    NOT NULL,
      payload     JSONB   NOT NULL DEFAULT '{}',
      is_read     BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      read_at     TIMESTAMP WITH TIME ZONE
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vn_vendor_idx   ON vendor_notifications (vendor_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vn_is_read_idx  ON vendor_notifications (is_read)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vn_created_idx  ON vendor_notifications (created_at DESC)`);
  logger.info("Vendor notifications migration: selesai (vendor_notifications table ready)");
}
