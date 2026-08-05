import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runCustomRolesMigration(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS custom_roles (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT,
        color       TEXT NOT NULL DEFAULT '#6366f1',
        permissions JSONB NOT NULL DEFAULT '[]',
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role_id INTEGER REFERENCES custom_roles(id) ON DELETE SET NULL
    `);

    logger.info("Custom roles migration: ok");
  } catch (err) {
    logger.error({ err }, "Custom roles migration failed");
    throw err;
  }
}
