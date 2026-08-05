/**
 * SAP HARDENING LAYER — Database Migration
 * Runs once at startup (idempotent via IF NOT EXISTS / IF NOT EXISTS column checks).
 *
 * Covers:
 *   FASE 1  — accounting_entries: is_locked, locked_at, locked_by
 *   FASE 5  — bank_mutation_normalized_entries: previous_version_id, is_latest_version
 *   FASE 6  — audit_accounting_events enhanced columns: change_reason, actor_type, correlation_id
 *   FASE 8  — integrity_audit_queue table
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

let _ran = false;

export async function runSapHardeningMigration(): Promise<void> {
  if (_ran) return;
  _ran = true;

  try {
    // ── FASE 1: Immutable Ledger columns ──────────────────────────────────────
    await db.execute(sql.raw(`
      ALTER TABLE accounting_entries
        ADD COLUMN IF NOT EXISTS is_locked     BOOLEAN   NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS locked_at     TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS locked_by     TEXT
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS ae_locked_idx ON accounting_entries(is_locked)
      WHERE is_locked = TRUE
    `));

    // ── FASE 5: Normalized-entry versioning columns ───────────────────────────
    // Wrapped in catch: relation bisa berupa VIEW pada DB lama, ALTER TABLE gagal di VIEW
    await db.execute(sql.raw(`
      ALTER TABLE bank_mutation_normalized_entries
        ADD COLUMN IF NOT EXISTS previous_version_id  INTEGER,
        ADD COLUMN IF NOT EXISTS is_latest_version     BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS version_number        INTEGER NOT NULL DEFAULT 1
    `)).catch(() => {});
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS bmne_latest_idx
      ON bank_mutation_normalized_entries(batch_id, is_latest_version)
      WHERE is_latest_version = TRUE
    `)).catch(() => {});

    // ── FASE 6: Audit trail enhanced columns ──────────────────────────────────
    // audit_accounting_events: add change_reason, actor_type, correlation_id
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS audit_accounting_events (
        id             BIGSERIAL PRIMARY KEY,
        journal_id     INTEGER,
        action         TEXT NOT NULL,
        company_id     INTEGER,
        erp_category   TEXT,
        amount         NUMERIC(18,2),
        before_state   JSONB,
        after_state    JSONB,
        user_id        TEXT,
        batch_id       INTEGER,
        import_row_id  INTEGER,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`
      ALTER TABLE audit_accounting_events
        ADD COLUMN IF NOT EXISTS change_reason   TEXT,
        ADD COLUMN IF NOT EXISTS actor_type      TEXT NOT NULL DEFAULT 'SYSTEM',
        ADD COLUMN IF NOT EXISTS correlation_id  TEXT
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS aae_company_action_idx
      ON audit_accounting_events(company_id, action, created_at DESC)
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS aae_correlation_idx
      ON audit_accounting_events(correlation_id)
      WHERE correlation_id IS NOT NULL
    `));

    // ── FASE 8: Integrity audit queue ─────────────────────────────────────────
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS integrity_audit_queue (
        id               BIGSERIAL PRIMARY KEY,
        company_id       INTEGER,
        classification   TEXT NOT NULL CHECK (classification IN ('LOW','MEDIUM','HIGH')),
        module           TEXT NOT NULL,
        error_code       TEXT,
        message          TEXT NOT NULL,
        context          JSONB,
        entity_type      TEXT,
        entity_id        TEXT,
        resolved         BOOLEAN NOT NULL DEFAULT FALSE,
        resolved_at      TIMESTAMPTZ,
        resolved_by      TEXT,
        resolution_notes TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS iaq_unresolved_idx
      ON integrity_audit_queue(company_id, classification, created_at DESC)
      WHERE resolved = FALSE
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS iaq_module_idx
      ON integrity_audit_queue(module, entity_type, entity_id)
      WHERE resolved = FALSE
    `));

    // ── FASE 3: master_coa_mapping for auto-repair ────────────────────────────
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS master_coa_mapping (
        id             SERIAL PRIMARY KEY,
        company_id     INTEGER,
        keyword        TEXT NOT NULL,
        erp_category   TEXT,
        entity_type    TEXT,
        coa_debit      TEXT,
        coa_credit     TEXT,
        confidence     NUMERIC(5,2) NOT NULL DEFAULT 80,
        is_active      BOOLEAN NOT NULL DEFAULT TRUE,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));
    // Backfill missing columns for existing tables (upgrade dari skema lama)
    await db.execute(sql.raw(`ALTER TABLE master_coa_mapping ADD COLUMN IF NOT EXISTS company_id INTEGER`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE master_coa_mapping ADD COLUMN IF NOT EXISTS keyword TEXT`)).catch(() => {});
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS mcm_keyword_idx ON master_coa_mapping(company_id, keyword)
    `)).catch(() => {});

    logger.info("[sap-hardening] Migration selesai — semua tabel/kolom siap");
  } catch (err) {
    logger.error({ err }, "[sap-hardening] Migration error (non-fatal, system tetap berjalan)");
  }
}
