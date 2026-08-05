import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runUserRoleMigration(): Promise<void> {
  try {
    await db.execute(
      sql`UPDATE users SET role = 'ecommerce' WHERE role IS NULL`
    );
    logger.info("User role migration: ok");
  } catch (err) {
    logger.error({ err }, "User role migration failed");
    throw err;
  }
}
