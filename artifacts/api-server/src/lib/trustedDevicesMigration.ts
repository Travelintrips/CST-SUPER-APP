import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runTrustedDevicesMigration() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS trusted_devices (
        id           SERIAL PRIMARY KEY,
        phone        TEXT NOT NULL,
        device_token TEXT NOT NULL UNIQUE,
        expires_at   TIMESTAMPTZ NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS trusted_devices_phone_idx  ON trusted_devices(phone);
      CREATE INDEX IF NOT EXISTS trusted_devices_token_idx  ON trusted_devices(device_token);
    `);
    logger.info("Trusted devices migration: ok");
  } catch (err) {
    logger.warn({ err }, "Trusted devices migration warn");
  }
}
