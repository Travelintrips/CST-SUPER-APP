import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

const KEY_PREFIX = "api_startup_migration:";

async function ensureStartupMarkerStore(): Promise<void> {
  const result = await db.execute(sql`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'app_config'
    LIMIT 1
  `);

  if (result.rows.length > 0) return;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app_config (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      is_secret  BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * Persistent completion markers for expensive bootstrap migrations.
 *
 * app_config already exists in the application runtime and is deliberately
 * used instead of creating another metadata table from the startup path. If
 * an older database does not have app_config yet, callers receive a safe
 * "not complete" result and retain their legacy migration behavior.
 */
export async function isStartupMigrationComplete(
  name: string,
  version: string,
): Promise<boolean> {
  const key = `${KEY_PREFIX}${name}`;
  try {
    await ensureStartupMarkerStore();
    const result = await db.execute(sql`
      SELECT value
      FROM app_config
      WHERE key = ${key}
      LIMIT 1
    `);
    return String((result.rows[0] as { value?: unknown } | undefined)?.value ?? "") === version;
  } catch (err) {
    logger.debug({ err, name }, "Startup migration marker unavailable; retaining legacy migration path");
    return false;
  }
}

export async function markStartupMigrationComplete(
  name: string,
  version: string,
  description: string,
): Promise<boolean> {
  const key = `${KEY_PREFIX}${name}`;
  try {
    await ensureStartupMarkerStore();
    await db.execute(sql`
      INSERT INTO app_config (key, value, description, updated_at)
      VALUES (${key}, ${version}, ${description}, NOW())
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value,
            description = EXCLUDED.description,
            updated_at = NOW()
    `);
    logger.info({ name, version }, "Startup migration marker persisted");
    return true;
  } catch (err) {
    // A missing/legacy app_config table must not make an otherwise successful
    // schema migration fail. The next process will safely re-run the legacy
    // path until the marker can be persisted.
    logger.warn({ err, name }, "Could not persist startup migration marker");
    return false;
  }
}