import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runNavPreferencesMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_nav_preferences (
      user_id      TEXT      PRIMARY KEY,
      hidden_items TEXT[]    NOT NULL DEFAULT '{}',
      item_order   TEXT[]    NOT NULL DEFAULT '{}',
      updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    ALTER TABLE user_nav_preferences
      ADD COLUMN IF NOT EXISTS item_order TEXT[] NOT NULL DEFAULT '{}'
  `);
  logger.info("Nav preferences migration: selesai (user_nav_preferences table ready)");
}
