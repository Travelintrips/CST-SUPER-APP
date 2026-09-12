import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runIntelligenceAlertSettingsMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS intelligence_alert_settings (
      id                          SERIAL PRIMARY KEY,
      company_id                  INTEGER,
      master_enabled              BOOLEAN NOT NULL DEFAULT TRUE,
      rfq_alert_enabled           BOOLEAN NOT NULL DEFAULT TRUE,
      rfq_warning_hours           INTEGER NOT NULL DEFAULT 24,
      rfq_critical_hours          INTEGER NOT NULL DEFAULT 48,
      margin_alert_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
      margin_min_pct              NUMERIC(6,2) NOT NULL DEFAULT 5.00,
      eta_alert_enabled           BOOLEAN NOT NULL DEFAULT TRUE,
      quote_expired_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      alert_window_start          TEXT NOT NULL DEFAULT '00:00',
      alert_window_end            TEXT NOT NULL DEFAULT '23:59',
      updated_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_by                  TEXT
    );
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS intelligence_alert_settings_company_idx
      ON intelligence_alert_settings (COALESCE(company_id, -1));
  `);

  await db.execute(sql`
    ALTER TABLE intelligence_alert_settings
      ADD COLUMN IF NOT EXISTS invoice_reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE
  `);

  logger.info("Intelligence alert settings migration: ok");
}
