import { pool } from "@workspace/db";
import { logger } from "./logger";

export async function runTranslationsMigration() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_translations (
        id          SERIAL PRIMARY KEY,
        app         TEXT NOT NULL,
        locale      TEXT NOT NULL,
        key         TEXT NOT NULL,
        value       TEXT NOT NULL,
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT app_translations_unique UNIQUE(app, locale, key)
      );
      CREATE INDEX IF NOT EXISTS app_translations_app_locale_idx
        ON app_translations(app, locale);
    `);
    logger.info("[translationsMigration] app_translations table ready");
  } catch (err) {
    logger.error({ err }, "[translationsMigration] migration failed");
    throw err;
  } finally {
    client.release();
  }
}
