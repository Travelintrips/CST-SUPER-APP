/**
 * taxSptMigration.ts
 * Migrasi tabel untuk fitur SPT Control:
 *  1. Kolom spt_status, excluded_reason, excluded_by, excluded_at → transaction_taxes
 *  2. Tabel tax_adjustments (BARU)
 *  3. Tabel tax_audit_logs (BARU)
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runTaxSptMigration(): Promise<void> {
  // ── A. Kolom baru di transaction_taxes ──────────────────────────────────────
  await db.execute(sql`
    ALTER TABLE transaction_taxes
    ADD COLUMN IF NOT EXISTS spt_status VARCHAR DEFAULT 'INCLUDED'
  `);
  await db.execute(sql`
    ALTER TABLE transaction_taxes
    ADD COLUMN IF NOT EXISTS excluded_reason TEXT
  `);
  await db.execute(sql`
    ALTER TABLE transaction_taxes
    ADD COLUMN IF NOT EXISTS excluded_by TEXT
  `);
  await db.execute(sql`
    ALTER TABLE transaction_taxes
    ADD COLUMN IF NOT EXISTS excluded_at TIMESTAMPTZ
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS tx_taxes_spt_status_idx
    ON transaction_taxes (company_id, period, spt_status)
  `);

  // ── B. Tabel tax_adjustments ─────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tax_adjustments (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id       INTEGER NOT NULL,
      transaction_tax_id INTEGER NOT NULL REFERENCES transaction_taxes(id) ON DELETE RESTRICT,
      adjustment_type  TEXT NOT NULL CHECK (adjustment_type IN ('CORRECTION','REVERSAL','OVERRIDE')),
      old_value        JSONB,
      new_value        JSONB,
      reason           TEXT NOT NULL,
      created_by       TEXT NOT NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approved_by      TEXT,
      approved_at      TIMESTAMPTZ,
      rejected_by      TEXT,
      rejected_at      TIMESTAMPTZ,
      rejection_reason TEXT,
      status           TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED'))
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS tax_adj_company_idx
    ON tax_adjustments (company_id, status)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS tax_adj_tx_tax_idx
    ON tax_adjustments (transaction_tax_id)
  `);

  // ── C. Tabel tax_audit_logs ──────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tax_audit_logs (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id    INTEGER NOT NULL,
      entity_type   TEXT NOT NULL,
      entity_id     TEXT NOT NULL,
      action        TEXT NOT NULL,
      before_data   JSONB,
      after_data    JSONB,
      performed_by  TEXT NOT NULL,
      ip_address    TEXT,
      timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS tax_audit_logs_company_idx
    ON tax_audit_logs (company_id, timestamp DESC)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS tax_audit_logs_entity_idx
    ON tax_audit_logs (entity_type, entity_id)
  `);

  logger.info("Tax SPT migration: selesai (spt_status cols + tax_adjustments + tax_audit_logs)");
}
