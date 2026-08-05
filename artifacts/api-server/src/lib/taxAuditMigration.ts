/**
 * taxAuditMigration.ts
 * Fase 1 — Schema Hardening (Tax Audit Center)
 *
 * Additive only — tidak menghapus kolom/tabel lama.
 *
 * Menambahkan ke transaction_taxes:
 *   dpp_nilai_lain, nik, validation_errors, metadata, include_in_spt, posting_date
 *
 * Tabel baru:
 *   tax_periods        — period lock control
 *   tax_export_batches — export batch header
 *   tax_export_rows    — export batch rows
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runTaxAuditMigration(): Promise<void> {
  // ── A. Kolom baru di transaction_taxes ────────────────────────────────────

  await db.execute(sql`
    ALTER TABLE transaction_taxes
    ADD COLUMN IF NOT EXISTS dpp_nilai_lain NUMERIC(14,2) DEFAULT 0
  `);

  await db.execute(sql`
    ALTER TABLE transaction_taxes
    ADD COLUMN IF NOT EXISTS nik TEXT
  `);

  await db.execute(sql`
    ALTER TABLE transaction_taxes
    ADD COLUMN IF NOT EXISTS validation_errors JSONB DEFAULT '[]'
  `);

  await db.execute(sql`
    ALTER TABLE transaction_taxes
    ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'
  `);

  await db.execute(sql`
    ALTER TABLE transaction_taxes
    ADD COLUMN IF NOT EXISTS include_in_spt BOOLEAN DEFAULT TRUE
  `);

  await db.execute(sql`
    ALTER TABLE transaction_taxes
    ADD COLUMN IF NOT EXISTS posting_date TIMESTAMPTZ
  `);

  // Sinkronisasi include_in_spt dari spt_status yang sudah ada
  await db.execute(sql`
    UPDATE transaction_taxes
    SET include_in_spt = (spt_status IS DISTINCT FROM 'EXCLUDED')
    WHERE include_in_spt IS NULL
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS tx_taxes_include_spt_idx
    ON transaction_taxes (company_id, period, include_in_spt)
  `);

  // ── B. Tabel tax_periods ───────────────────────────────────────────────────

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tax_periods (
      id           SERIAL PRIMARY KEY,
      company_id   INTEGER NOT NULL,
      tax_period   TEXT NOT NULL,
      tax_type     TEXT NOT NULL DEFAULT 'ALL',
      status       TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','validating','locked','exported','revised')),
      locked_at    TIMESTAMPTZ,
      locked_by    TEXT,
      exported_at  TIMESTAMPTZ,
      exported_by  TEXT,
      revised_at   TIMESTAMPTZ,
      revised_by   TEXT,
      notes        TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS tax_periods_company_period_type_uniq
    ON tax_periods (company_id, tax_period, tax_type)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS tax_periods_status_idx
    ON tax_periods (company_id, status)
  `);

  // ── C. Tabel tax_export_batches ───────────────────────────────────────────

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tax_export_batches (
      id          SERIAL PRIMARY KEY,
      company_id  INTEGER NOT NULL,
      tax_period  TEXT NOT NULL,
      tax_type    TEXT NOT NULL,
      export_type TEXT NOT NULL DEFAULT 'CSV',
      status      TEXT NOT NULL DEFAULT 'pending',
      file_name   TEXT,
      row_count   INTEGER NOT NULL DEFAULT 0,
      total_dpp   NUMERIC(18,2) NOT NULL DEFAULT 0,
      total_tax   NUMERIC(18,2) NOT NULL DEFAULT 0,
      created_by  TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS tax_export_batches_company_period_idx
    ON tax_export_batches (company_id, tax_period)
  `);

  // ── D. Tabel tax_export_rows ──────────────────────────────────────────────

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tax_export_rows (
      id                   SERIAL PRIMARY KEY,
      batch_id             INTEGER NOT NULL REFERENCES tax_export_batches(id) ON DELETE CASCADE,
      transaction_tax_id   INTEGER REFERENCES transaction_taxes(id) ON DELETE SET NULL,
      row_number           INTEGER NOT NULL,
      row_data             JSONB NOT NULL,
      validation_errors    JSONB NOT NULL DEFAULT '[]',
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS tax_export_rows_batch_idx
    ON tax_export_rows (batch_id)
  `);

  logger.info("[taxAuditMigration] Fase 1 selesai — kolom baru + tax_periods + tax_export_batches + tax_export_rows");
}
