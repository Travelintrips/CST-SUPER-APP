import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runPhase1Migration(): Promise<void> {
  // ── New tables ────────────────────────────────────────────────────────────

  // workflow_events removed: tabel legacy Phase 1 tidak pernah dipakai,
  // dihapus dari boot migration 2026-06-23 (lihat next-release-drop-legacy-tables.sql)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS intelligence_alerts (
      id               SERIAL PRIMARY KEY,
      company_id       INTEGER,
      alert_type       TEXT NOT NULL,
      entity_type      TEXT NOT NULL,
      entity_id        INTEGER,
      entity_ref       TEXT,
      severity         TEXT NOT NULL DEFAULT 'warning',
      title            TEXT NOT NULL,
      message          TEXT NOT NULL,
      context_json     JSONB DEFAULT '{}',
      status           TEXT NOT NULL DEFAULT 'open',
      is_read          BOOLEAN NOT NULL DEFAULT FALSE,
      acknowledged_at  TIMESTAMP,
      acknowledged_by  TEXT,
      resolved_at      TIMESTAMP,
      resolved_by      TEXT,
      triggered_at     TIMESTAMP NOT NULL DEFAULT NOW(),
      created_at       TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS intelligence_alerts_company_status_idx
      ON intelligence_alerts(company_id, status);
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS order_stage_logs (
      id             SERIAL PRIMARY KEY,
      order_id       INTEGER NOT NULL REFERENCES logistic_orders(id) ON DELETE CASCADE,
      company_id     INTEGER,
      stage_from     TEXT,
      stage_to       TEXT NOT NULL,
      duration_hours NUMERIC(10,2),
      actor_id       TEXT,
      actor_type     TEXT NOT NULL DEFAULT 'system',
      actor_name     TEXT,
      notes          TEXT,
      created_at     TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS order_stage_logs_order_idx ON order_stage_logs(order_id);
  `);

  // ── New columns on logistic_orders ────────────────────────────────────────

  const loColumns: Array<[string, string]> = [
    ["direction",            "TEXT"],
    ["is_dangerous_good",    "BOOLEAN DEFAULT FALSE"],
    ["service_category",     "TEXT"],
    ["cargo_special_tags",   "TEXT[]"],
    ["required_docs",        "TEXT[]"],
  ];

  for (const [col, colDef] of loColumns) {
    await db.execute(sql.raw(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='logistic_orders' AND column_name='${col}'
        ) THEN
          ALTER TABLE logistic_orders ADD COLUMN ${col} ${colDef};
        END IF;
      END $$;
    `));
  }

  // ── New columns on suppliers ───────────────────────────────────────────────

  const supplierColumns: Array<[string, string]> = [
    ["eta_days_min", "INTEGER"],
    ["eta_days_max", "INTEGER"],
    ["has_internal_truck", "BOOLEAN NOT NULL DEFAULT FALSE"],
    ["internal_truck_price", "NUMERIC(14,2)"],
  ];

  for (const [col, colDef] of supplierColumns) {
    await db.execute(sql.raw(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='suppliers' AND column_name='${col}'
        ) THEN
          ALTER TABLE suppliers ADD COLUMN ${col} ${colDef};
        END IF;
      END $$;
    `));
  }

  // ── Add expires_at alias index (valid_until already exists) ───────────────
  // customer_quote_links already has valid_until — no new column needed.

  // ── New columns on logistic_orders (truck assignment) ─────────────────────

  const loTruckColumns: Array<[string, string]> = [
    ["truck_vendor_id", "INTEGER REFERENCES suppliers(id) ON DELETE SET NULL"],
    ["truck_price",     "NUMERIC(14,2)"],
    ["truck_source",    "TEXT"],
    ["product_price",   "NUMERIC(14,2)"],
  ];

  for (const [col, colDef] of loTruckColumns) {
    await db.execute(sql.raw(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='logistic_orders' AND column_name='${col}'
        ) THEN
          ALTER TABLE logistic_orders ADD COLUMN ${col} ${colDef};
        END IF;
      END $$;
    `));
  }

  logger.info("Phase 1 migration: ok (intelligence_alerts, order_stage_logs, new columns)");
}
