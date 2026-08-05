import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runSessionsMigration(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sessions (
        sid     VARCHAR PRIMARY KEY,
        sess    JSONB    NOT NULL,
        expire  TIMESTAMP NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON sessions (expire)
    `);
    logger.info("Sessions migration: ok (sessions table ready)");
  } catch (err) {
    logger.error({ err }, "Sessions migration failed");
    throw err;
  }
}
