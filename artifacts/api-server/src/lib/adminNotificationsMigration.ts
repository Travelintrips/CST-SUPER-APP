import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runAdminNotificationsMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS admin_notifications (
      id            SERIAL PRIMARY KEY,
      type          TEXT NOT NULL,
      order_id      INTEGER,
      order_number  TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      company_name  TEXT,
      payload       JSONB NOT NULL DEFAULT '{}',
      read_at       TIMESTAMP WITH TIME ZONE,
      created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS admin_notif_type_idx    ON admin_notifications (type)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS admin_notif_read_idx    ON admin_notifications (read_at)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS admin_notif_created_idx ON admin_notifications (created_at DESC)`);
  // Add title/body columns if missing — NOT NULL with empty-string default so
  // existing rows are not violated and new inserts can always supply a value.
  await db.execute(sql`ALTER TABLE admin_notifications ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT ''`);
  await db.execute(sql`ALTER TABLE admin_notifications ADD COLUMN IF NOT EXISTS body  TEXT NOT NULL DEFAULT ''`);
  logger.info("Admin notifications migration: selesai (admin_notifications table ready)");
}
